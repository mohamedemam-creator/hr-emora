-- Company-wide quota settings. Null leave limits mean "not configured" so the
-- migration does not invent legal or contractual entitlements.
create table if not exists public.company_leave_policies (
 company_id uuid primary key references public.companies(id) on delete cascade,
 annual_leave_days numeric(8,2) check(annual_leave_days is null or annual_leave_days between 0 and 366),
 monthly_leave_days numeric(8,2) check(monthly_leave_days is null or monthly_leave_days between 0 and 31),
 sick_leave_days numeric(8,2) check(sick_leave_days is null or sick_leave_days between 0 and 366),
 updated_by uuid,
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(updated_by,company_id) references public.employees(id,company_id) on delete set null (updated_by)
);
alter table public.company_leave_policies enable row level security;
alter table public.company_leave_policies force row level security;
revoke all on table public.company_leave_policies from public,anon,authenticated,service_role;

alter table public.leave_types add column if not exists quota_category text not null default 'custom'
 check(quota_category in ('annual','monthly','sick','custom'));

create function public.app_company_leave_policy() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('leaves.manage_types'); p public.company_leave_policies;
begin
 select * into p from public.company_leave_policies where company_id=c;
 return jsonb_build_object('annual_leave_days',p.annual_leave_days,
  'monthly_leave_days',p.monthly_leave_days,'sick_leave_days',p.sick_leave_days,
  'updated_at',p.updated_at);
end; $$;
revoke all on function public.app_company_leave_policy() from public,anon;
grant execute on function public.app_company_leave_policy() to authenticated;

create function public.app_save_company_leave_policy(
 p_annual_leave_days numeric,p_monthly_leave_days numeric,p_sick_leave_days numeric
) returns void language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('leaves.manage_types'); actor uuid:=public.current_employee_id(); old_row public.company_leave_policies;
begin
 if p_annual_leave_days is not null and p_annual_leave_days not between 0 and 366 then raise exception 'annual leave limit must be between 0 and 366' using errcode='22023'; end if;
 if p_monthly_leave_days is not null and p_monthly_leave_days not between 0 and 31 then raise exception 'monthly leave limit must be between 0 and 31' using errcode='22023'; end if;
 if p_sick_leave_days is not null and p_sick_leave_days not between 0 and 366 then raise exception 'sick leave limit must be between 0 and 366' using errcode='22023'; end if;
 select * into old_row from public.company_leave_policies where company_id=c for update;
 insert into public.company_leave_policies(company_id,annual_leave_days,monthly_leave_days,sick_leave_days,updated_by,updated_at)
 values(c,p_annual_leave_days,p_monthly_leave_days,p_sick_leave_days,actor,clock_timestamp())
 on conflict(company_id) do update set annual_leave_days=excluded.annual_leave_days,
  monthly_leave_days=excluded.monthly_leave_days,sick_leave_days=excluded.sick_leave_days,
  updated_by=excluded.updated_by,updated_at=clock_timestamp();
 perform app_private.audit_company_action(c,'leave.policy.updated','company_leave_policy',c,
  case when old_row.company_id is null then null else to_jsonb(old_row) end,
  jsonb_build_object('annual_leave_days',p_annual_leave_days,'monthly_leave_days',p_monthly_leave_days,
   'sick_leave_days',p_sick_leave_days));
end; $$;
revoke all on function public.app_save_company_leave_policy(numeric,numeric,numeric) from public,anon;
grant execute on function public.app_save_company_leave_policy(numeric,numeric,numeric) to authenticated;

create function public.app_my_leave_policy_balance() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
 c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); tz text;
 today_value date; year_start date; year_end date; month_start date; month_end date;
 annual_limit numeric; monthly_limit numeric; sick_limit numeric;
 annual_used numeric:=0; monthly_used numeric:=0; sick_used numeric:=0;
 annual_pending numeric:=0; monthly_pending numeric:=0; sick_pending numeric:=0;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select coalesce(companies.timezone,'Africa/Cairo') into tz from public.companies as companies where companies.id=c;
 today_value:=(clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date;
 year_start:=date_trunc('year',today_value)::date; year_end:=(year_start+interval '1 year - 1 day')::date;
 month_start:=date_trunc('month',today_value)::date; month_end:=(month_start+interval '1 month - 1 day')::date;
 select policy.annual_leave_days,policy.monthly_leave_days,policy.sick_leave_days
  into annual_limit,monthly_limit,sick_limit from public.company_leave_policies as policy where policy.company_id=c;
 select
  coalesce(sum((least(requests.ends_on,year_end)-greatest(requests.starts_on,year_start)+1)::numeric)
   filter(where leave_types.quota_category='annual' and requests.status='approved'),0),
  coalesce(sum((least(requests.ends_on,month_end)-greatest(requests.starts_on,month_start)+1)::numeric)
   filter(where leave_types.quota_category='monthly' and requests.status='approved'),0),
  coalesce(sum((least(requests.ends_on,year_end)-greatest(requests.starts_on,year_start)+1)::numeric)
   filter(where leave_types.quota_category='sick' and requests.status='approved'),0),
  coalesce(sum((least(requests.ends_on,year_end)-greatest(requests.starts_on,year_start)+1)::numeric)
   filter(where leave_types.quota_category='annual' and requests.status='pending'),0),
  coalesce(sum((least(requests.ends_on,month_end)-greatest(requests.starts_on,month_start)+1)::numeric)
   filter(where leave_types.quota_category='monthly' and requests.status='pending'),0),
  coalesce(sum((least(requests.ends_on,year_end)-greatest(requests.starts_on,year_start)+1)::numeric)
   filter(where leave_types.quota_category='sick' and requests.status='pending'),0)
 into annual_used,monthly_used,sick_used,annual_pending,monthly_pending,sick_pending
 from public.leave_requests as requests
 join public.leave_types as leave_types on leave_types.id=requests.leave_type_id and leave_types.company_id=requests.company_id
 where requests.company_id=c and requests.employee_id=e and requests.status in ('approved','pending')
  and ((leave_types.quota_category in ('annual','sick') and requests.starts_on<=year_end and requests.ends_on>=year_start)
   or (leave_types.quota_category='monthly' and requests.starts_on<=month_end and requests.ends_on>=month_start));
 return jsonb_build_object(
  'annual_limit',annual_limit,'annual_used',annual_used,'annual_pending',annual_pending,
  'annual_remaining',case when annual_limit is null then null else greatest(annual_limit-annual_used-annual_pending,0) end,
  'monthly_limit',monthly_limit,'monthly_used',monthly_used,'monthly_pending',monthly_pending,
  'monthly_remaining',case when monthly_limit is null then null else greatest(monthly_limit-monthly_used-monthly_pending,0) end,
  'sick_limit',sick_limit,'sick_used',sick_used,'sick_pending',sick_pending,
  'sick_remaining',case when sick_limit is null then null else greatest(sick_limit-sick_used-sick_pending,0) end,
  'year',extract(year from today_value)::integer,'month',month_start);
end; $$;
revoke all on function public.app_my_leave_policy_balance() from public,anon;
grant execute on function public.app_my_leave_policy_balance() to authenticated;

create function public.app_list_leave_types_with_category()
returns table(id uuid,name text,code text,is_paid boolean,requires_attachment boolean,quota_category text,is_active boolean)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('leaves.manage_types');
begin
 return query select lt.id,lt.name,lt.code,lt.is_paid,lt.requires_attachment,lt.quota_category,lt.is_active
  from public.leave_types lt where lt.company_id=c order by lt.is_active desc,lt.name;
end; $$;
revoke all on function public.app_list_leave_types_with_category() from public,anon;
grant execute on function public.app_list_leave_types_with_category() to authenticated;

create function public.app_save_leave_type_with_category(
 p_id uuid,p_name text,p_code text,p_is_paid boolean,p_quota_category text,p_is_active boolean
) returns uuid language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('leaves.manage_types'); type_id uuid:=p_id; old_row public.leave_types;
begin
 if nullif(btrim(p_name),'') is null or nullif(btrim(p_code),'') is null
  or char_length(btrim(p_name))>80 or char_length(btrim(p_code))>32
  or p_quota_category not in ('annual','monthly','sick','custom') then
  raise exception 'invalid leave type settings' using errcode='22023';
 end if;
 if type_id is null then
  insert into public.leave_types(company_id,name,code,is_paid,requires_attachment,annual_entitlement,quota_category,is_active)
  values(c,btrim(p_name),upper(btrim(p_code)),coalesce(p_is_paid,false),false,null,p_quota_category,coalesce(p_is_active,true)) returning id into type_id;
 else
  select * into old_row from public.leave_types where id=type_id and company_id=c for update;
  if not found then raise exception 'leave type is outside company' using errcode='42501'; end if;
  if old_row.requires_attachment then raise exception 'attachment-required leave types cannot be edited until the portal supports uploads' using errcode='0A000'; end if;
  update public.leave_types set name=btrim(p_name),code=upper(btrim(p_code)),is_paid=coalesce(p_is_paid,false),
   quota_category=p_quota_category,is_active=coalesce(p_is_active,true)
   where id=type_id and company_id=c;
 end if;
 if not exists(select 1 from public.leave_types where company_id=c and is_active) then raise exception 'at least one active leave type is required' using errcode='23514'; end if;
 perform app_private.audit_company_action(c,'leave_type.saved','leave_type',type_id,
  case when p_id is null then null else to_jsonb(old_row) end,
  jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),'is_paid',coalesce(p_is_paid,false),
   'quota_category',p_quota_category,'is_active',coalesce(p_is_active,true)));
 return type_id;
end; $$;
revoke all on function public.app_save_leave_type_with_category(uuid,text,text,boolean,text,boolean) from public,anon;
grant execute on function public.app_save_leave_type_with_category(uuid,text,text,boolean,text,boolean) to authenticated;

create function app_private.enforce_company_leave_policy()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
 category_value text; annual_limit numeric; monthly_limit numeric; sick_limit numeric;
 segment_start date; segment_end date; limit_value numeric; existing_days numeric; new_days numeric;
begin
 if new.status not in ('pending','approved') then return new; end if;
 perform 1 from public.employees as employees
  where employees.id=new.employee_id and employees.company_id=new.company_id for update;
 select lt.quota_category into category_value from public.leave_types lt
  where lt.id=new.leave_type_id and lt.company_id=new.company_id and lt.is_active;
 if category_value is null then raise exception 'active leave type is required' using errcode='23503'; end if;
 select p.annual_leave_days,p.monthly_leave_days,p.sick_leave_days
  into annual_limit,monthly_limit,sick_limit from public.company_leave_policies p where p.company_id=new.company_id;
 if category_value in ('annual','sick') then
  limit_value:=case when category_value='annual' then annual_limit else sick_limit end;
  if limit_value is not null then
   segment_start:=date_trunc('year',new.starts_on)::date;
   while segment_start<=new.ends_on loop
    segment_end:=least(new.ends_on,(segment_start+interval '1 year - 1 day')::date);
    new_days:=(segment_end-greatest(new.starts_on,segment_start))+1;
    select coalesce(sum((least(existing.ends_on,segment_end)-greatest(existing.starts_on,segment_start)+1)::numeric),0)
     into existing_days from public.leave_requests existing
     join public.leave_types existing_type on existing_type.id=existing.leave_type_id and existing_type.company_id=existing.company_id
     where existing.company_id=new.company_id and existing.employee_id=new.employee_id
      and existing.status in ('pending','approved') and existing.id is distinct from new.id
      and existing_type.quota_category=category_value
      and existing.starts_on<=segment_end and existing.ends_on>=segment_start;
    if existing_days+new_days>limit_value then raise exception '% leave quota exceeded for the calendar year',category_value using errcode='23514'; end if;
    segment_start:=(segment_start+interval '1 year')::date;
   end loop;
  end if;
 elsif category_value='monthly' and monthly_limit is not null then
  segment_start:=date_trunc('month',new.starts_on)::date;
  while segment_start<=new.ends_on loop
   segment_end:=least(new.ends_on,(segment_start+interval '1 month - 1 day')::date);
   new_days:=(segment_end-greatest(new.starts_on,segment_start))+1;
   select coalesce(sum((least(existing.ends_on,segment_end)-greatest(existing.starts_on,segment_start)+1)::numeric),0)
    into existing_days from public.leave_requests existing
    join public.leave_types existing_type on existing_type.id=existing.leave_type_id and existing_type.company_id=existing.company_id
    where existing.company_id=new.company_id and existing.employee_id=new.employee_id
     and existing.status in ('pending','approved') and existing.id is distinct from new.id
     and existing_type.quota_category='monthly'
     and existing.starts_on<=segment_end and existing.ends_on>=segment_start;
   if existing_days+new_days>monthly_limit then raise exception 'monthly leave quota exceeded for the calendar month' using errcode='23514'; end if;
   segment_start:=(segment_start+interval '1 month')::date;
  end loop;
 end if;
 return new;
end; $$;
revoke all on function app_private.enforce_company_leave_policy() from public,anon,authenticated;
drop trigger if exists leave_policy_quota_guard on public.leave_requests;
create trigger leave_policy_quota_guard before insert or update of leave_type_id,starts_on,ends_on,status
 on public.leave_requests for each row execute function app_private.enforce_company_leave_policy();

notify pgrst, 'reload schema';
