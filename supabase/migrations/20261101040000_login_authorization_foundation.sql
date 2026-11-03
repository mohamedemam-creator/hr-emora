-- Additive login and first-company setup foundation for the existing six-table database.
-- Supabase migration runners provide the transaction boundary; do not add BEGIN/COMMIT.
-- This migration is prepared locally only and has not been applied to production.

-- Add only fields required by the active setup flow. Existing employee.role values
-- are deliberately preserved and are never used to infer platform authority.
alter table public.employees add column employee_code text;
alter table public.employees add column phone text;
alter table public.employees add column must_change_password boolean not null default false;
create unique index employees_company_employee_code_uidx
  on public.employees(company_id, employee_code)
  where employee_code is not null;

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  granted_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  grant_reason text not null
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'active'
    check (status in ('invited','active','suspended','ended')),
  joined_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, user_id)
);
create index company_memberships_user_status_idx
  on public.company_memberships(user_id, status, company_id);

create table public.user_company_context (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, user_id)
    references public.company_memberships(company_id, user_id) on delete cascade
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module text not null,
  name text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, code),
  unique (id, company_id)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  scope_level text not null default 'company'
    check (scope_level in ('company','region','branch','department','own')),
  primary key (role_id, permission_id, scope_level)
);

create table public.employee_roles (
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.employees(id) on delete set null,
  assigned_at timestamptz not null default clock_timestamp(),
  primary key (employee_id, role_id)
);

-- Existing rows are linked to memberships without rewriting their company role.
insert into public.company_memberships(company_id, user_id, employee_id, status, joined_at)
select e.company_id, e.user_id, e.id, 'active', e.created_at
from public.employees e
where e.user_id is not null and e.company_id is not null
on conflict (company_id, user_id) do nothing;

-- Trusted, migration-owner-controlled bootstrap for the confirmed founder account.
-- No browser-callable function can grant or revoke platform authority.
do $platform_bootstrap$
begin
  if not exists (
    select 1 from auth.users u where u.id = '3cdf50fa-6395-44cc-9abc-8ea2577bd0e5'::uuid
  ) then
    raise exception 'approved founder Auth user was not found';
  end if;
  insert into public.platform_admins(user_id, grant_reason)
  values ('3cdf50fa-6395-44cc-9abc-8ea2577bd0e5'::uuid,
          'Explicit founder bootstrap approved by the account owner')
  on conflict (user_id) do nothing;
end;
$platform_bootstrap$;

alter table public.platform_admins enable row level security;
alter table public.company_memberships enable row level security;
alter table public.user_company_context enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.employee_roles enable row level security;

revoke all on table
  public.platform_admins,
  public.company_memberships,
  public.user_company_context,
  public.permissions,
  public.roles,
  public.role_permissions,
  public.employee_roles
from public, anon, authenticated, service_role;

create function public.app_current_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_employee_id uuid;
  v_full_name text;
  v_is_platform_admin boolean;
  v_memberships jsonb := '[]'::jsonb;
  v_roles jsonb := '[]'::jsonb;
  v_permissions jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.platform_admins p
    where p.user_id = v_user_id and p.revoked_at is null
  ) into v_is_platform_admin;

  select coalesce(jsonb_agg(
    jsonb_build_object('company_id', c.id, 'company_name', c.name)
    order by c.name
  ), '[]'::jsonb)
  into v_memberships
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  where m.user_id = v_user_id and m.status = 'active';

  select x.company_id into v_company_id
  from public.user_company_context x
  join public.company_memberships m
    on m.user_id = x.user_id and m.company_id = x.company_id and m.status = 'active'
  where x.user_id = v_user_id;

  if v_company_id is null then
    select (array_agg(m.company_id))[1] into v_company_id
    from public.company_memberships m
    where m.user_id = v_user_id and m.status = 'active'
    having count(*) = 1;
  end if;

  if v_company_id is not null then
    select e.id, e.full_name into v_employee_id, v_full_name
    from public.company_memberships m
    join public.employees e on e.id = m.employee_id and e.company_id = m.company_id
    where m.user_id = v_user_id
      and m.company_id = v_company_id
      and m.status = 'active'
      and e.user_id = v_user_id;

    select coalesce(jsonb_agg(distinct jsonb_build_object(
      'id', r.id, 'name', r.name, 'code', r.code
    )), '[]'::jsonb)
    into v_roles
    from public.employee_roles er
    join public.employees e on e.id = er.employee_id
    join public.roles r on r.id = er.role_id and r.company_id = v_company_id and r.is_active
    where e.id = v_employee_id and e.user_id = v_user_id and e.company_id = v_company_id;

    if v_roles = '[]'::jsonb then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', null, 'name', e.role, 'code', e.role, 'source', 'legacy_company_role'
      )), '[]'::jsonb)
      into v_roles
      from public.employees e
      where e.id = v_employee_id and e.company_id = v_company_id
        and e.user_id = v_user_id and e.role is not null;
    end if;

    select coalesce(jsonb_agg(distinct p.code), '[]'::jsonb)
    into v_permissions
    from public.employee_roles er
    join public.employees e on e.id = er.employee_id and e.user_id = v_user_id
    join public.roles r on r.id = er.role_id and r.company_id = v_company_id and r.is_active
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where e.id = v_employee_id and e.company_id = v_company_id;
  end if;

  if v_is_platform_admin then
    insert into public.audit_logs(
      actor_user_id, actor_platform_role, action, category,
      entity_type, status, context
    ) values (
      v_user_id, 'PLATFORM_SUPER_ADMIN', 'platform.identity_resolved',
      'authorization', 'platform_context', 'success',
      jsonb_build_object(
        'source', 'app_current_access',
        'session_id', auth.jwt()->>'session_id'
      )
    );
  end if;

  return jsonb_build_object(
    'employee_id', v_employee_id,
    'company_id', v_company_id,
    'full_name', v_full_name,
    'permissions', v_permissions,
    'roles', v_roles,
    'is_platform_admin', v_is_platform_admin,
    'memberships', v_memberships,
    'platform_context', case when v_is_platform_admin then
      jsonb_build_object('role', 'PLATFORM_SUPER_ADMIN', 'selected_company_id', null)
      else null end
  );
end;
$function$;
revoke all on function public.app_current_access() from public, anon;
grant execute on function public.app_current_access() to authenticated;

create function public.app_clear_password_change_flag()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  update public.employees
  set must_change_password = false
  where user_id = auth.uid() and must_change_password;
end;
$function$;
revoke all on function public.app_clear_password_change_flag() from public, anon;
grant execute on function public.app_clear_password_change_flag() to authenticated;

create function public.service_bootstrap_company(
  p_user_id uuid,
  p_company_name text,
  p_company_code text,
  p_owner_name text,
  p_employee_code text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_employee_id uuid;
  v_role_id uuid;
  v_email text;
begin
  if p_user_id is null then raise exception 'authenticated user required'; end if;
  if nullif(btrim(p_company_name), '') is null or length(p_company_name) > 160 then
    raise exception 'invalid company name';
  end if;
  if p_company_code is null or p_company_code !~ '^[A-Z0-9_-]{2,20}$' then
    raise exception 'invalid company code';
  end if;
  if nullif(btrim(p_owner_name), '') is null or length(p_owner_name) > 160 then
    raise exception 'invalid owner name';
  end if;
  if p_employee_code is null or p_employee_code !~ '^[A-Z0-9_-]{2,32}$' then
    raise exception 'invalid employee code';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'authenticated user not found';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);
  if exists (select 1 from public.company_memberships m where m.user_id = p_user_id)
     or exists (select 1 from public.employees e where e.user_id = p_user_id)
     or exists (select 1 from public.employees e where v_email is not null and lower(e.email) = lower(v_email))
     or exists (select 1 from public.platform_admins p where p.user_id = p_user_id and p.revoked_at is null) then
    raise exception 'account is already linked to a company or is a platform account';
  end if;

  insert into public.companies(name, code)
  values (btrim(p_company_name), p_company_code)
  returning id into v_company_id;

  insert into public.employees(company_id, user_id, employee_code, full_name, email, phone)
  values (v_company_id, p_user_id, p_employee_code, btrim(p_owner_name), v_email, nullif(btrim(p_phone), ''))
  returning id into v_employee_id;

  insert into public.company_memberships(company_id, user_id, employee_id, status, joined_at)
  values (v_company_id, p_user_id, v_employee_id, 'active', clock_timestamp());

  insert into public.roles(company_id, name, code, is_system)
  values (v_company_id, 'مالك الشركة', 'COMPANY_OWNER', true)
  returning id into v_role_id;

  insert into public.employee_roles(employee_id, role_id, assigned_by)
  values (v_employee_id, v_role_id, v_employee_id);

  return jsonb_build_object('company_id', v_company_id, 'employee_id', v_employee_id);
end;
$function$;
revoke all on function public.service_bootstrap_company(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.service_bootstrap_company(uuid,text,text,text,text,text)
  to service_role;

-- The public setup policies and existing table grants are restricted separately
-- by 20261101050000_lockdown_legacy_table_access.sql, after this path is deployed
-- and verified in staging.
