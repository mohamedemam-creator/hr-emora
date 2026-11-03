-- Employee management and verified-email activation. Local only; depends on 40000.

alter table public.employees add column address text;
alter table public.employees add column department_id uuid;
alter table public.employees add column job_title_id uuid;
alter table public.employees add column direct_manager_id uuid;
alter table public.employees add column hire_date date;
alter table public.employees add column employment_status text not null default 'active'
  check (employment_status in ('active','suspended','terminated','on_leave'));
alter table public.employees add column salary_type text not null default 'monthly'
  check (salary_type in ('monthly','daily','hourly'));
alter table public.employees add column base_salary numeric(14,2) not null default 0 check (base_salary >= 0);
alter table public.employees add column overtime_hour_rate numeric(14,2) not null default 0 check (overtime_hour_rate >= 0);
alter table public.employees add column login_enabled boolean not null default true;
alter table public.employees add column deleted_at timestamptz;
alter table public.employees add column updated_at timestamptz not null default clock_timestamp();
alter table public.employees add column account_invited_at timestamptz;

create unique index employees_company_code_ci_uidx on public.employees(company_id, lower(btrim(employee_code))) where employee_code is not null;
create unique index employees_company_email_ci_uidx on public.employees(company_id, lower(btrim(email))) where email is not null and deleted_at is null;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, code text not null, is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,code)
);
create table public.job_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null, code text not null,
  default_role_id uuid references public.roles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(company_id,code)
);
alter table public.departments enable row level security;
alter table public.job_titles enable row level security;
revoke all on table public.departments,public.job_titles from public,anon,authenticated,service_role;

create function public.current_company_id() returns uuid
language plpgsql stable security definer set search_path=''
as $function$
declare u uuid:=auth.uid(); c uuid;
begin
  if u is null then return null; end if;
  select x.company_id into c from public.user_company_context x
    join public.company_memberships m on m.user_id=x.user_id and m.company_id=x.company_id and m.status='active'
    where x.user_id=u;
  if c is not null then return c; end if;
  select (array_agg(m.company_id))[1] into c from public.company_memberships m
    where m.user_id=u and m.status='active' having count(*)=1;
  return c;
end;
$function$;
revoke all on function public.current_company_id() from public,anon;
grant execute on function public.current_company_id() to authenticated;

create function public.current_employee_id() returns uuid
language sql stable security definer set search_path=''
as $function$
  select e.id from public.company_memberships m
    join public.employees e on e.id=m.employee_id and e.company_id=m.company_id
    where m.user_id=auth.uid() and m.company_id=public.current_company_id() and m.status='active'
      and e.employment_status='active' and e.login_enabled and e.deleted_at is null limit 1;
$function$;
revoke all on function public.current_employee_id() from public,anon;
grant execute on function public.current_employee_id() to authenticated;

create function public.has_permission(p_permission_code text) returns boolean
language sql stable security definer set search_path=''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.company_memberships m
      join public.employees e on e.id=m.employee_id and e.company_id=m.company_id
      where m.user_id=auth.uid() and m.company_id=public.current_company_id() and m.status='active'
        and e.employment_status='active' and e.login_enabled and e.deleted_at is null
        and (e.role='company_admin'
          or exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id
            where er.employee_id=e.id and r.company_id=e.company_id and r.is_active and r.code='COMPANY_OWNER')
          or exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=e.company_id and r.is_active
            join public.role_permissions rp on rp.role_id=r.id and rp.scope_level='company'
            join public.permissions p on p.id=rp.permission_id and p.code=p_permission_code where er.employee_id=e.id))
  );
$function$;
revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated;

create function public.app_select_company(p_company_id uuid) returns void
language plpgsql security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.company_id=p_company_id and m.status='active') then
    raise exception 'active company membership required' using errcode='42501';
  end if;
  insert into public.user_company_context(user_id,company_id,updated_at) values(auth.uid(),p_company_id,clock_timestamp())
    on conflict(user_id) do update set company_id=excluded.company_id,updated_at=excluded.updated_at;
end;
$function$;
revoke all on function public.app_select_company(uuid) from public,anon;
grant execute on function public.app_select_company(uuid) to authenticated;

create function public.app_next_employee_code() returns text
language plpgsql stable security definer set search_path=''
as $function$
declare n bigint;
begin
  if public.current_company_id() is null or not public.has_permission('employees.manage') then raise exception 'employee management permission required' using errcode='42501'; end if;
  select coalesce(max(e.employee_code::bigint),0)+1 into n from public.employees e where e.company_id=public.current_company_id() and btrim(e.employee_code)~'^[0-9]+$';
  return n::text;
end;
$function$;
revoke all on function public.app_next_employee_code() from public,anon;
grant execute on function public.app_next_employee_code() to authenticated;

create function public.app_employee_options() returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare c uuid:=public.current_company_id();
begin
  if c is null or not public.has_permission('employees.manage') then raise exception 'employee management permission required' using errcode='42501'; end if;
  return jsonb_build_object(
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code,'region_id',b.region_id) order by b.name) from public.branches b where b.company_id=c),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'code',d.code) order by d.name) from public.departments d where d.company_id=c and d.is_active),'[]'::jsonb),
    'job_titles',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'name',j.name,'code',j.code,'department_id',j.department_id,'default_role_id',j.default_role_id) order by j.name) from public.job_titles j where j.company_id=c and j.is_active),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'code',r.code) order by r.name) from public.roles r where r.company_id=c and r.is_active),'[]'::jsonb),
    'managers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'code',e.employee_code,'branch_id',e.branch_id) order by e.full_name) from public.employees e where e.company_id=c and e.employment_status='active' and e.deleted_at is null),'[]'::jsonb));
end;
$function$;
revoke all on function public.app_employee_options() from public,anon;
grant execute on function public.app_employee_options() to authenticated;

create function public.app_list_employees_v3()
returns table(id uuid,employee_code text,full_name text,phone text,email text,address text,branch_id uuid,branch_name text,branch_code text,department_id uuid,department_name text,job_title_id uuid,job_title_name text,direct_manager_id uuid,direct_manager_name text,hire_date date,employment_status text,salary_type text,base_salary numeric,overtime_hour_rate numeric,has_login boolean,login_enabled boolean,must_change_password boolean,account_invited_at timestamptz,role_ids jsonb,role_names text,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $function$
begin
  if public.current_company_id() is null or not (public.has_permission('employees.view_all') or public.has_permission('employees.manage')) then raise exception 'employee viewing permission required' using errcode='42501'; end if;
  return query select e.id,e.employee_code,e.full_name,e.phone,e.email,e.address,e.branch_id,b.name,b.code,e.department_id,d.name,e.job_title_id,j.name,e.direct_manager_id,m.full_name,e.hire_date,e.employment_status,e.salary_type,e.base_salary,e.overtime_hour_rate,e.user_id is not null,e.login_enabled,e.must_change_password,e.account_invited_at,
    coalesce((select jsonb_agg(r.id order by r.name) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=e.company_id where er.employee_id=e.id),'[]'::jsonb),
    coalesce((select string_agg(r.name,'، ' order by r.name) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=e.company_id where er.employee_id=e.id),''),e.created_at
  from public.employees e left join public.branches b on b.id=e.branch_id and b.company_id=e.company_id left join public.departments d on d.id=e.department_id and d.company_id=e.company_id left join public.job_titles j on j.id=e.job_title_id and j.company_id=e.company_id left join public.employees m on m.id=e.direct_manager_id and m.company_id=e.company_id
  where e.company_id=public.current_company_id() and e.deleted_at is null order by e.employment_status='active' desc,e.full_name;
end;
$function$;
revoke all on function public.app_list_employees_v3() from public,anon;
grant execute on function public.app_list_employees_v3() to authenticated;

create function public.app_save_employee_v2(p_employee_id uuid,p_employee_code text,p_full_name text,p_phone text,p_email text,p_address text,p_branch_id uuid,p_department_id uuid,p_job_title_id uuid,p_direct_manager_id uuid,p_hire_date date,p_salary_type text,p_base_salary numeric,p_overtime_hour_rate numeric,p_status text,p_role_ids jsonb)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare c uuid:=public.current_company_id(); e_id uuid:=p_employee_id; code text; default_role uuid; role_id uuid;
begin
  if c is null or not public.has_permission('employees.manage') then raise exception 'employee management permission required' using errcode='42501'; end if;
  if nullif(btrim(p_full_name),'') is null then raise exception 'full name is required'; end if;
  if lower(coalesce(p_status,'active')) not in ('active','suspended','terminated','on_leave') then raise exception 'invalid employment status'; end if;
  if lower(coalesce(p_salary_type,'monthly')) not in ('monthly','daily','hourly') then raise exception 'invalid salary type'; end if;
  if coalesce(p_base_salary,0)<0 or coalesce(p_overtime_hour_rate,0)<0 then raise exception 'salary values cannot be negative'; end if;
  if p_role_ids is not null and jsonb_typeof(p_role_ids)<>'array' then raise exception 'role_ids must be an array'; end if;
  if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside company'; end if;
  if p_department_id is not null and not exists(select 1 from public.departments d where d.id=p_department_id and d.company_id=c and d.is_active) then raise exception 'department is outside company'; end if;
  if p_job_title_id is not null then select j.default_role_id into default_role from public.job_titles j where j.id=p_job_title_id and j.company_id=c and j.is_active; if not found then raise exception 'job title is outside company'; end if; end if;
  if p_direct_manager_id is not null and (p_direct_manager_id=p_employee_id or not exists(select 1 from public.employees x where x.id=p_direct_manager_id and x.company_id=c and x.deleted_at is null)) then raise exception 'manager is outside company'; end if;
  if coalesce(jsonb_array_length(p_role_ids),0)>0 and not (public.has_permission('employees.assign_roles') or public.has_permission('roles.manage')) then raise exception 'role assignment permission required' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_role_ids,'[]'::jsonb)) x(id) where not exists(select 1 from public.roles r where r.id=x.id::uuid and r.company_id=c and r.is_active)) then raise exception 'selected role is outside company'; end if;
  if e_id is null then
    perform pg_advisory_xact_lock(hashtext(c::text||':employee-code')::bigint);
    if nullif(btrim(p_employee_code),'') is null then select (coalesce(max(x.employee_code::bigint),0)+1)::text into code from public.employees x where x.company_id=c and btrim(x.employee_code)~'^[0-9]+$'; else code:=upper(btrim(p_employee_code)); end if;
    insert into public.employees(company_id,employee_code,full_name,phone,email,address,branch_id,department_id,job_title_id,direct_manager_id,hire_date,employment_status,salary_type,base_salary,overtime_hour_rate)
      values(c,code,btrim(p_full_name),nullif(btrim(p_phone),''),nullif(lower(btrim(p_email)),''),nullif(btrim(p_address),''),p_branch_id,p_department_id,p_job_title_id,p_direct_manager_id,p_hire_date,lower(coalesce(p_status,'active')),lower(coalesce(p_salary_type,'monthly')),coalesce(p_base_salary,0),coalesce(p_overtime_hour_rate,0)) returning id into e_id;
  else
    if not exists(select 1 from public.employees x where x.id=e_id and x.company_id=c and x.deleted_at is null) then raise exception 'employee is outside company' using errcode='42501'; end if;
    if exists(select 1 from public.employees x where x.id=e_id and x.user_id is not null and lower(coalesce(x.email,''))<>lower(coalesce(p_email,''))) then raise exception 'login email changes require the employee account email flow'; end if;
    update public.employees x set full_name=btrim(p_full_name),phone=nullif(btrim(p_phone),''),email=nullif(lower(btrim(p_email)),''),address=nullif(btrim(p_address),''),branch_id=p_branch_id,department_id=p_department_id,job_title_id=p_job_title_id,direct_manager_id=p_direct_manager_id,hire_date=p_hire_date,employment_status=lower(coalesce(p_status,'active')),salary_type=lower(coalesce(p_salary_type,'monthly')),base_salary=coalesce(p_base_salary,0),overtime_hour_rate=coalesce(p_overtime_hour_rate,0),updated_at=clock_timestamp() where x.id=e_id and x.company_id=c;
  end if;
  if public.has_permission('employees.assign_roles') or public.has_permission('roles.manage') then
    delete from public.employee_roles er where er.employee_id=e_id;
    if coalesce(jsonb_array_length(p_role_ids),0)>0 then
      for role_id in select value::uuid from jsonb_array_elements_text(p_role_ids) loop insert into public.employee_roles(employee_id,role_id,assigned_by) values(e_id,role_id,public.current_employee_id()); end loop;
    elsif default_role is not null then insert into public.employee_roles(employee_id,role_id,assigned_by) values(e_id,default_role,public.current_employee_id()); end if;
  end if;
  return e_id;
exception when unique_violation then raise exception 'employee code or email is already used in this company' using errcode='23505';
end;
$function$;
revoke all on function public.app_save_employee_v2(uuid,text,text,text,text,text,uuid,uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb) from public,anon;
grant execute on function public.app_save_employee_v2(uuid,text,text,text,text,text,uuid,uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb) to authenticated;

create function public.app_set_employee_status(p_employee_id uuid,p_status text) returns boolean
language plpgsql security definer set search_path=''
as $function$
begin
  if not public.has_permission('employees.manage') then raise exception 'employee management permission required' using errcode='42501'; end if;
  if p_employee_id=public.current_employee_id() then raise exception 'cannot suspend your own employee account'; end if;
  if p_status not in ('active','suspended','terminated','on_leave') then raise exception 'invalid employment status'; end if;
  update public.employees e set employment_status=p_status,updated_at=clock_timestamp() where e.id=p_employee_id and e.company_id=public.current_company_id() and e.deleted_at is null;
  if not found then raise exception 'employee is outside company' using errcode='42501'; end if;
  update public.company_memberships m set status=case when e.employment_status='active' and e.login_enabled then 'active' else 'suspended' end
    from public.employees e where m.employee_id=e.id and m.company_id=e.company_id and e.id=p_employee_id;
  return true;
end;
$function$;
revoke all on function public.app_set_employee_status(uuid,text) from public,anon;
grant execute on function public.app_set_employee_status(uuid,text) to authenticated;

create function public.app_my_pending_employee_invitations() returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare email_value text;
begin
  select lower(u.email) into email_value from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if email_value is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'employee_id',e.id,'company_id',c.id,'company_name',c.name,'employee_name',e.full_name,
    'role_names',coalesce((select string_agg(r.name,'، ' order by r.name) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=e.company_id where er.employee_id=e.id),'')
  ) order by c.name)
  from public.employees e join public.companies c on c.id=e.company_id
  where e.user_id is null and e.deleted_at is null and e.employment_status='active' and lower(e.email)=email_value
    and not exists(select 1 from public.company_memberships m where m.company_id=e.company_id and m.user_id=auth.uid())), '[]'::jsonb);
end;
$function$;
revoke all on function public.app_my_pending_employee_invitations() from public,anon;
grant execute on function public.app_my_pending_employee_invitations() to authenticated;

create function public.app_accept_employee_invitation(p_employee_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare email_value text; company_value uuid; employee_value uuid; linked_user uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select lower(u.email) into email_value from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if email_value is null then raise exception 'verify this email before accepting an invitation' using errcode='42501'; end if;
  select e.id,e.company_id,e.user_id into employee_value,company_value,linked_user
    from public.employees e where e.id=p_employee_id and lower(e.email)=email_value and e.deleted_at is null and e.employment_status='active' for update;
  if not found then raise exception 'invitation is not available for this verified email' using errcode='42501'; end if;
  if linked_user is not null and linked_user<>auth.uid() then raise exception 'employee is linked to another account' using errcode='23505'; end if;
  if exists(select 1 from public.company_memberships m where m.company_id=company_value and m.user_id=auth.uid() and m.employee_id is distinct from employee_value) then
    raise exception 'account already has an employee membership in this company' using errcode='23505';
  end if;
  update public.employees set user_id=auth.uid(),updated_at=clock_timestamp() where id=employee_value and company_id=company_value;
  insert into public.company_memberships(company_id,user_id,employee_id,status,joined_at)
    values(company_value,auth.uid(),employee_value,'active',clock_timestamp())
    on conflict(company_id,user_id) do update set employee_id=excluded.employee_id,status='active',joined_at=coalesce(public.company_memberships.joined_at,excluded.joined_at);
  return jsonb_build_object('company_id',company_value,'employee_id',employee_value);
end;
$function$;
revoke all on function public.app_accept_employee_invitation(uuid) from public,anon;
grant execute on function public.app_accept_employee_invitation(uuid) to authenticated;

create function public.service_employee_account_context(p_actor_user_id uuid,p_employee_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare result jsonb;
begin
  select jsonb_build_object('employee_id',target.id,'company_id',target.company_id,'email',lower(target.email),'full_name',target.full_name,'employment_status',target.employment_status,
    'user_id',target.user_id,'has_login',target.user_id is not null,'login_enabled',target.login_enabled,'account_invited_at',target.account_invited_at)
  into result
  from public.employees actor
    join public.company_memberships m on m.employee_id=actor.id and m.company_id=actor.company_id and m.user_id=p_actor_user_id and m.status='active'
    join public.employees target on target.id=p_employee_id and target.company_id=actor.company_id and target.deleted_at is null
  where actor.user_id=p_actor_user_id and actor.employment_status='active' and actor.login_enabled and actor.deleted_at is null
    and (actor.role='company_admin'
      or exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=actor.company_id and r.is_active where er.employee_id=actor.id and r.code='COMPANY_OWNER')
      or exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=actor.company_id and r.is_active join public.role_permissions rp on rp.role_id=r.id and rp.scope_level='company' join public.permissions p on p.id=rp.permission_id and p.code='employees.manage_accounts' where er.employee_id=actor.id));
  if result is null then raise exception 'employee account permission required' using errcode='42501'; end if;
  return result;
end;
$function$;
revoke all on function public.service_employee_account_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_employee_account_context(uuid,uuid) to service_role;

create function public.service_set_employee_account_state(p_actor_user_id uuid,p_employee_id uuid,p_login_enabled boolean default null,p_must_change_password boolean default null,p_invited_at timestamptz default null) returns void
language plpgsql security definer set search_path=''
as $function$
declare company_value uuid;
begin
  perform public.service_employee_account_context(p_actor_user_id,p_employee_id);
  select company_id into company_value from public.employees where id=p_employee_id;
  update public.employees e set login_enabled=coalesce(p_login_enabled,e.login_enabled),must_change_password=coalesce(p_must_change_password,e.must_change_password),account_invited_at=coalesce(p_invited_at,e.account_invited_at),updated_at=clock_timestamp()
    where e.id=p_employee_id and e.company_id=company_value;
  update public.company_memberships m set status=case when e.employment_status='active' and e.login_enabled then 'active' else 'suspended' end
    from public.employees e where m.employee_id=e.id and m.company_id=e.company_id and e.id=p_employee_id and m.user_id=e.user_id;
end;
$function$;
revoke all on function public.service_set_employee_account_state(uuid,uuid,boolean,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.service_set_employee_account_state(uuid,uuid,boolean,boolean,timestamptz) to service_role;
