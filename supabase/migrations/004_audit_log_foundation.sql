-- Append-only audit foundation for the currently confirmed public tables.
-- Apply only after reviewing against the target environment. Never run from this task.
-- Supabase migration runners provide the transaction boundary; do not embed BEGIN/COMMIT.

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_employee_id uuid,
  actor_company_role text,
  actor_platform_role text,
  company_id uuid,
  action text not null,
  category text not null,
  entity_type text not null,
  entity_id text,
  occurred_at timestamptz not null default clock_timestamp(),
  status text not null default 'success' check (status in ('success', 'failure')),
  old_data jsonb,
  new_data jsonb,
  context jsonb not null default '{}'::jsonb
);

create index if not exists audit_logs_company_time_idx
  on public.audit_logs (company_id, occurred_at desc);
create index if not exists audit_logs_actor_time_idx
  on public.audit_logs (actor_user_id, occurred_at desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index if not exists audit_logs_action_time_idx
  on public.audit_logs (action, occurred_at desc);

comment on column public.audit_logs.actor_company_role is
  'Company-scoped role snapshot only; never represents Emora platform authority.';
comment on column public.audit_logs.actor_platform_role is
  'Platform-scoped authority snapshot, separate from any company membership role.';

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated, service_role;
grant insert on table public.audit_logs to service_role;

create function public.audit_log_business_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  before_row jsonb;
  after_row jsonb;
  record_row jsonb;
  affected_company uuid;
  affected_entity text;
  affected_action text;
  affected_category text;
  actor uuid := auth.uid();
  actor_employee uuid;
  allowed_fields text[];
begin
  -- Service-role Edge Functions log the validated human actor explicitly.
  -- Do not create anonymous/service-role rows that cannot be attributed.
  if actor is null or coalesce(auth.jwt()->>'role', '') = 'service_role' then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    after_row := to_jsonb(NEW);
    record_row := after_row;
  elsif TG_OP = 'UPDATE' then
    before_row := to_jsonb(OLD);
    after_row := to_jsonb(NEW);
    record_row := after_row;
  else
    before_row := to_jsonb(OLD);
    record_row := before_row;
  end if;

  affected_entity := CASE TG_TABLE_NAME
    WHEN 'companies' THEN 'company'
    WHEN 'regions' THEN 'region'
    WHEN 'branches' THEN 'branch'
    WHEN 'employees' THEN 'employee'
    WHEN 'shifts' THEN 'shift'
    WHEN 'attendance_logs' THEN 'attendance'
    ELSE TG_TABLE_NAME
  END;
  affected_category := CASE TG_TABLE_NAME
    WHEN 'companies' THEN 'company'
    WHEN 'regions' THEN 'organization'
    WHEN 'branches' THEN 'organization'
    WHEN 'employees' THEN 'identity'
    WHEN 'shifts' THEN 'scheduling'
    WHEN 'attendance_logs' THEN 'attendance'
    ELSE 'administration'
  END;
  affected_action := affected_entity || '.' || lower(TG_OP);

  if TG_TABLE_NAME = 'companies' then
    affected_company := nullif(record_row->>'id', '')::uuid;
  else
    affected_company := nullif(record_row->>'company_id', '')::uuid;
  end if;

  if TG_TABLE_NAME = 'employees'
     and TG_OP = 'DELETE'
     and record_row->>'user_id' = actor::text then
    actor_employee := nullif(record_row->>'id', '')::uuid;
  else
    select e.id into actor_employee
    from public.employees e
    where e.user_id = actor
      and (affected_company is null or e.company_id = affected_company)
    order by e.created_at desc
    limit 1;
  end if;

  -- Keep audit snapshots useful while avoiding passwords, tokens, precise
  -- location, contact details, addresses, and compensation data.
  allowed_fields := CASE TG_TABLE_NAME
    WHEN 'companies' THEN array['id','name','code']
    WHEN 'regions' THEN array['id','company_id','name','code']
    WHEN 'branches' THEN array['id','company_id','region_id','name','code','attendance_radius_m','minimum_gps_accuracy_m']
    WHEN 'employees' THEN array['id','company_id','branch_id','user_id','employee_code','role','employment_status','status','department_id','job_title_id','direct_manager_id','login_enabled']
    WHEN 'shifts' THEN array['id','company_id','name','start_time','end_time']
    WHEN 'attendance_logs' THEN array['id','company_id','employee_id','branch_id','check_in','check_out','status']
    ELSE array['id','company_id']
  END;

  if before_row is not null then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into before_row
    from jsonb_each(before_row) where key = any(allowed_fields);
  end if;
  if after_row is not null then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into after_row
    from jsonb_each(after_row) where key = any(allowed_fields);
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_employee_id, company_id, action, category,
    entity_type, entity_id, status, old_data, new_data
  ) values (
    actor, actor_employee, affected_company, affected_action, affected_category,
    affected_entity, record_row->>'id', 'success', before_row, after_row
  );

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$function$;

revoke all on function public.audit_log_business_row_change() from public, anon, authenticated;

create function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'audit_logs is append-only';
end;
$function$;

revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;

create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

do $migration$
declare
  table_name text;
begin
  foreach table_name in array array['companies','regions','branches','employees','shifts','attendance_logs'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'create trigger audit_business_row_change after insert or update or delete on public.%I for each row execute function public.audit_log_business_row_change()',
        table_name
      );
    end if;
  end loop;
end;
$migration$;

