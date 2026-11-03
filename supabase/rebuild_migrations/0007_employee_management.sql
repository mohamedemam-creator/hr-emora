-- Company-scoped employee APIs for the greenfield schema.
-- Auth invitations are delivered only by the manage-employee-account Edge Function.

alter table public.employees add column account_invited_at timestamptz;

create unique index employees_company_code_ci_uidx on public.employees(company_id, lower(btrim(employee_code)));
create unique index employees_company_email_ci_uidx on public.employees(company_id, lower(btrim(email))) where email is not null and deleted_at is null;


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
declare c uuid:=public.current_company_id(); e_id uuid:=p_employee_id; code text; default_role uuid; role_id uuid; old_snapshot jsonb; old_email text;
begin
  if c is null or not public.has_permission('employees.manage') then raise exception 'employee management permission required' using errcode='42501'; end if;
  if nullif(btrim(p_full_name),'') is null then raise exception 'full name is required'; end if;
  if lower(coalesce(p_status,'active')) not in ('active','suspended','terminated','on_leave') then raise exception 'invalid employment status'; end if;
  if lower(coalesce(p_salary_type,'monthly')) not in ('monthly','daily','hourly') then raise exception 'invalid salary type'; end if;
  if coalesce(p_base_salary,0)<0 or coalesce(p_overtime_hour_rate,0)<0 then raise exception 'salary values cannot be negative'; end if;
  if p_role_ids is not null and jsonb_typeof(p_role_ids)<>'array' then raise exception 'role_ids must be an array'; end if;
  if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside company'; end if;
  if p_employee_id is not null and not (public.has_permission('employees.assign_roles') or public.has_permission('roles.manage'))
    and exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=c
      where er.employee_id=p_employee_id and r.code in ('BRANCH_MANAGER','AREA_MANAGER'))
    and exists(select 1 from public.employees x where x.id=p_employee_id and x.company_id=c and x.branch_id is distinct from p_branch_id) then
    raise exception 'changing a scoped manager branch requires role assignment permission' using errcode='42501';
  end if;
  if p_department_id is not null and not exists(select 1 from public.departments d where d.id=p_department_id and d.company_id=c and d.is_active) then raise exception 'department is outside company'; end if;
  if p_job_title_id is not null then select j.default_role_id into default_role from public.job_titles j where j.id=p_job_title_id and j.company_id=c and j.is_active; if not found then raise exception 'job title is outside company'; end if; end if;
  if p_direct_manager_id is not null and (p_direct_manager_id=p_employee_id or not exists(select 1 from public.employees x where x.id=p_direct_manager_id and x.company_id=c and x.deleted_at is null)) then raise exception 'manager is outside company'; end if;
  if coalesce(jsonb_array_length(p_role_ids),0)>0 and not (public.has_permission('employees.assign_roles') or public.has_permission('roles.manage')) then raise exception 'role assignment permission required' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_role_ids,'[]'::jsonb)) x(id)
    join public.roles r on r.id=x.id::uuid and r.company_id=c and r.code='COMPANY_OWNER')
    and not public.has_permission('roles.manage') then
    raise exception 'only a company owner can assign the COMPANY_OWNER role' using errcode='42501';
  end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_role_ids,'[]'::jsonb)) x(id) where not exists(select 1 from public.roles r where r.id=x.id::uuid and r.company_id=c and r.is_active)) then raise exception 'selected role is outside company'; end if;
  if e_id is null then
    perform pg_advisory_xact_lock(hashtext(c::text||':employee-code')::bigint);
    if nullif(btrim(p_employee_code),'') is null then select (coalesce(max(x.employee_code::bigint),0)+1)::text into code from public.employees x where x.company_id=c and btrim(x.employee_code)~'^[0-9]+$'; else code:=upper(btrim(p_employee_code)); end if;
    insert into public.employees(company_id,employee_code,full_name,phone,email,address,branch_id,department_id,job_title_id,direct_manager_id,hire_date,employment_status,salary_type,base_salary,overtime_hour_rate)
      values(c,code,btrim(p_full_name),nullif(btrim(p_phone),''),nullif(lower(btrim(p_email)),''),nullif(btrim(p_address),''),p_branch_id,p_department_id,p_job_title_id,p_direct_manager_id,p_hire_date,lower(coalesce(p_status,'active')),lower(coalesce(p_salary_type,'monthly')),coalesce(p_base_salary,0),coalesce(p_overtime_hour_rate,0)) returning id into e_id;
  else
    select jsonb_build_object('full_name',x.full_name,'employment_status',x.employment_status,'branch_id',x.branch_id,
      'department_id',x.department_id,'job_title_id',x.job_title_id,'direct_manager_id',x.direct_manager_id)
      ,lower(coalesce(x.email,'')) into old_snapshot,old_email from public.employees x where x.id=e_id and x.company_id=c and x.deleted_at is null for update;
    if not found then raise exception 'employee is outside company' using errcode='42501'; end if;
    if exists(select 1 from public.employees x where x.id=e_id and x.user_id is not null and lower(coalesce(x.email,''))<>lower(coalesce(p_email,''))) then raise exception 'login email changes require the employee account email flow'; end if;
    update public.employees x set full_name=btrim(p_full_name),phone=nullif(btrim(p_phone),''),email=nullif(lower(btrim(p_email)),''),address=nullif(btrim(p_address),''),branch_id=p_branch_id,department_id=p_department_id,job_title_id=p_job_title_id,direct_manager_id=p_direct_manager_id,hire_date=p_hire_date,employment_status=lower(coalesce(p_status,'active')),salary_type=lower(coalesce(p_salary_type,'monthly')),base_salary=coalesce(p_base_salary,0),overtime_hour_rate=coalesce(p_overtime_hour_rate,0),account_invited_at=case when old_email is distinct from lower(coalesce(nullif(btrim(p_email),''),'')) then null else x.account_invited_at end,updated_at=clock_timestamp() where x.id=e_id and x.company_id=c;
  end if;
  if public.has_permission('employees.assign_roles') or public.has_permission('roles.manage') then
    delete from public.employee_roles er where er.employee_id=e_id;
    if coalesce(jsonb_array_length(p_role_ids),0)>0 then
      for role_id in select value::uuid from jsonb_array_elements_text(p_role_ids) loop insert into public.employee_roles(employee_id,role_id,assigned_by) values(e_id,role_id,public.current_employee_id()); end loop;
    else
      if default_role is null then select r.id into default_role from public.roles r where r.company_id=c and r.code='EMPLOYEE' and r.is_active; end if;
      if default_role is not null then insert into public.employee_roles(employee_id,role_id,assigned_by) values(e_id,default_role,public.current_employee_id()); end if;
    end if;
  elsif p_employee_id is null then
    select r.id into default_role from public.roles r where r.company_id=c and r.code='EMPLOYEE' and r.is_active;
    if default_role is not null then insert into public.employee_roles(employee_id,role_id) values(e_id,default_role) on conflict do nothing; end if;
  end if;
  -- Keep manager scope bound to the specific employee-role assignment. A
  -- branch/region permission without a matching role scope fails closed.
  delete from public.employee_scope_assignments esa
  using public.roles scoped_role
  where esa.employee_id=e_id and esa.role_id=scoped_role.id and scoped_role.company_id=c
    and scoped_role.code in ('BRANCH_MANAGER','AREA_MANAGER') and esa.scope_level in ('branch','region');
  insert into public.employee_scope_assignments(employee_id,role_id,company_id,scope_level,scope_id)
  select e_id,r.id,c,'branch',target.branch_id
  from public.roles r join public.employee_roles er on er.role_id=r.id and er.employee_id=e_id
  cross join lateral (
    select p_branch_id as branch_id where p_branch_id is not null
    union
    select a.branch_id from public.employee_branch_assignments a where a.employee_id=e_id and a.company_id=c
      and a.starts_on<=current_date and (a.ends_on is null or a.ends_on>=current_date)
  ) target
  where r.company_id=c and r.code='BRANCH_MANAGER' and r.is_active;
  insert into public.employee_scope_assignments(employee_id,role_id,company_id,scope_level,scope_id)
  select e_id,r.id,c,'region',target.region_id
  from public.roles r join public.employee_roles er on er.role_id=r.id and er.employee_id=e_id
  cross join lateral (
    select b.region_id from public.branches b where b.id=p_branch_id and b.company_id=c and b.region_id is not null
    union
    select a.region_id from public.employee_region_assignments a where a.employee_id=e_id and a.company_id=c
      and a.starts_on<=current_date and (a.ends_on is null or a.ends_on>=current_date)
  ) target
  where r.company_id=c and r.code='AREA_MANAGER' and r.is_active;
  insert into public.audit_logs(actor_user_id,actor_membership_id,actor_employee_id,actor_company_role,
    company_id,action,category,entity_type,entity_id,status,old_data,new_data,context)
  select auth.uid(),m.id,public.current_employee_id(),
    (select string_agg(distinct r.code,',' order by r.code) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=c where er.employee_id=public.current_employee_id()),
    c,case when p_employee_id is null then 'employee.created' else 'employee.updated' end,'employee',
    'employee',e_id,'success',old_snapshot,jsonb_build_object('employee_code',e.employee_code,'full_name',e.full_name,'employment_status',e.employment_status,'branch_id',e.branch_id,'department_id',e.department_id,'job_title_id',e.job_title_id,'direct_manager_id',e.direct_manager_id),
    jsonb_build_object('source','app_save_employee_v2')
  from public.employees e join public.company_memberships m on m.company_id=c and m.user_id=auth.uid() and m.status='active'
  where e.id=e_id and e.company_id=c;
  return e_id;
exception when unique_violation then raise exception 'employee code or email is already used in this company' using errcode='23505';
end;
$function$;
revoke all on function public.app_save_employee_v2(uuid,text,text,text,text,text,uuid,uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb) from public,anon;
grant execute on function public.app_save_employee_v2(uuid,text,text,text,text,text,uuid,uuid,uuid,uuid,date,text,numeric,numeric,text,jsonb) to authenticated;

create function public.app_set_employee_status(p_employee_id uuid,p_status text) returns boolean
language plpgsql security definer set search_path=''
as $function$
declare old_status text;
begin
  if not public.has_permission('employees.manage') then raise exception 'employee management permission required' using errcode='42501'; end if;
  if p_employee_id=public.current_employee_id() then raise exception 'cannot suspend your own employee account'; end if;
  if p_status not in ('active','suspended','terminated','on_leave') then raise exception 'invalid employment status'; end if;
  select e.employment_status into old_status from public.employees e where e.id=p_employee_id and e.company_id=public.current_company_id() and e.deleted_at is null for update;
  if not found then raise exception 'employee is outside company' using errcode='42501'; end if;
  update public.employees e set employment_status=p_status,updated_at=clock_timestamp() where e.id=p_employee_id and e.company_id=public.current_company_id() and e.deleted_at is null;
  update public.company_memberships m set status=case when e.employment_status='active' and e.login_enabled then 'active' else 'suspended' end
    from public.employees e where m.employee_id=e.id and m.company_id=e.company_id and e.id=p_employee_id;
  insert into public.audit_logs(actor_user_id,actor_membership_id,actor_employee_id,actor_company_role,
    company_id,action,category,entity_type,entity_id,status,old_data,new_data,context)
  select auth.uid(),m.id,public.current_employee_id(),
    (select string_agg(distinct r.code,',' order by r.code) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=public.current_company_id() where er.employee_id=public.current_employee_id()),
    public.current_company_id(),'employee.status.changed','employee','employee',p_employee_id,'success',jsonb_build_object('status',old_status),jsonb_build_object('status',p_status),
    jsonb_build_object('source','app_set_employee_status')
  from public.company_memberships m where m.user_id=auth.uid() and m.company_id=public.current_company_id() and m.status='active';
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
  where e.user_id is null and e.deleted_at is null and e.employment_status='active' and e.login_enabled and lower(e.email)=email_value
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
    from public.employees e where e.id=p_employee_id and lower(e.email)=email_value and e.deleted_at is null and e.employment_status='active' and e.login_enabled for update;
  if not found then raise exception 'invitation is not available for this verified email' using errcode='42501'; end if;
  if linked_user is not null and linked_user<>auth.uid() then raise exception 'employee is linked to another account' using errcode='23505'; end if;
  if exists(select 1 from public.company_memberships m where m.company_id=company_value and m.user_id=auth.uid() and m.employee_id is distinct from employee_value) then
    raise exception 'account already has an employee membership in this company' using errcode='23505';
  end if;
  update public.employees set user_id=auth.uid(),updated_at=clock_timestamp() where id=employee_value and company_id=company_value;
  insert into public.company_memberships(company_id,user_id,employee_id,status,joined_at)
    values(company_value,auth.uid(),employee_value,'active',clock_timestamp())
    on conflict(company_id,user_id) do update set employee_id=excluded.employee_id,status='active',joined_at=coalesce(public.company_memberships.joined_at,excluded.joined_at);
  insert into public.audit_logs(actor_user_id,actor_membership_id,actor_employee_id,actor_company_role,
    company_id,action,category,entity_type,entity_id,status,context)
  select auth.uid(),m.id,employee_value,
    (select string_agg(distinct r.code,',' order by r.code) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=company_value where er.employee_id=employee_value),
    company_value,'employee.invitation.accepted','identity','employee',employee_value,'success',
    jsonb_build_object('source','app_accept_employee_invitation')
  from public.company_memberships m where m.company_id=company_value and m.user_id=auth.uid();
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
    and (exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=actor.company_id and r.is_active where er.employee_id=actor.id and r.code='COMPANY_OWNER')
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

create function public.app_delete_employee(p_employee_id uuid) returns boolean
language plpgsql security definer set search_path=''
as $function$
declare c uuid:=app_private.require_company_permission('employees.delete'); e public.employees; timezone_name text; today_local date;
begin
 if p_employee_id=public.current_employee_id() then raise exception 'cannot archive your own employee record' using errcode='42501'; end if;
 select x.* into e from public.employees x where x.id=p_employee_id and x.company_id=c and x.deleted_at is null for update;
 if not found then raise exception 'employee is outside current company' using errcode='42501'; end if;
 if exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=c and r.code='COMPANY_OWNER'
   where er.employee_id=e.id)
   and (select count(distinct er.employee_id) from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=c and r.code='COMPANY_OWNER'
     join public.employees owner_employee on owner_employee.id=er.employee_id and owner_employee.company_id=c and owner_employee.deleted_at is null and owner_employee.employment_status='active')<2 then
  raise exception 'cannot archive the last active company owner' using errcode='42501';
 end if;
 select coalesce(co.timezone,'Africa/Cairo') into timezone_name from public.companies co where co.id=c;
 today_local:=(clock_timestamp() at time zone coalesce(timezone_name,'Africa/Cairo'))::date;
 if exists(select 1 from public.attendance_sessions a where a.company_id=c and a.employee_id=e.id
  and (coalesce(a.check_in_at,a.created_at) at time zone coalesce(timezone_name,'Africa/Cairo'))::date>=date_trunc('month',today_local::timestamp)::date
  and (coalesce(a.check_in_at,a.created_at) at time zone coalesce(timezone_name,'Africa/Cairo'))::date<=(today_local)) then
  raise exception 'employee has attendance during the current month; archive is not allowed' using errcode='23503';
 end if;
 update public.employees set deleted_at=clock_timestamp(),employment_status='terminated',login_enabled=false,updated_at=clock_timestamp()
  where id=e.id and company_id=c;
 update public.company_memberships set status='ended' where employee_id=e.id and company_id=c;
 perform app_private.audit_company_action(c,'employee.archived','employee',e.id,
  jsonb_build_object('employment_status',e.employment_status,'login_enabled',e.login_enabled,'deleted_at',e.deleted_at),
  jsonb_build_object('employment_status','terminated','login_enabled',false,'deleted_at',clock_timestamp()));
 return true;
end;
$function$;
revoke all on function public.app_delete_employee(uuid) from public,anon;
grant execute on function public.app_delete_employee(uuid) to authenticated;

create function public.app_list_employees_v2()
returns table(id uuid,employee_code text,full_name text,branch_name text,employment_status text)
language plpgsql stable security definer set search_path=''
as $function$
declare c uuid:=public.current_company_id();
begin
 if c is null or not (public.has_permission('penalties.view') or public.has_permission('penalties.manage') or public.has_permission('employees.view_all')) then
  raise exception 'employee list permission required' using errcode='42501';
 end if;
 return query select e.id,e.employee_code,e.full_name,b.name,e.employment_status
  from public.employees e left join public.branches b on b.id=e.branch_id and b.company_id=c
  where e.company_id=c and e.deleted_at is null and e.employment_status='active' order by e.full_name;
end;
$function$;
revoke all on function public.app_list_employees_v2() from public,anon;
grant execute on function public.app_list_employees_v2() to authenticated;

create function public.app_import_employees_v2(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 c uuid:=app_private.require_company_permission('employees.manage');
 row_value jsonb; row_number integer:=0; inserted_count integer:=0; failed_count integer:=0;
 errors jsonb:='[]'::jsonb; employee_id uuid; branch_value uuid; department_value uuid; job_value uuid; manager_value uuid;
 role_values jsonb; code_value text; email_value text; role_codes text[]; role_ids uuid[]; requested_role text;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'rows must be an array with at most 500 entries' using errcode='22023'; end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  row_number:=row_number+1;
  begin
   code_value:=upper(btrim(coalesce(row_value->>'employee_code','')));
   email_value:=nullif(lower(btrim(coalesce(row_value->>'email',''))),'');
   if code_value='' or nullif(btrim(coalesce(row_value->>'full_name','')),'') is null then raise exception 'employee code and full name are required'; end if;
   if exists(select 1 from public.employees e where e.company_id=c and (lower(btrim(e.employee_code))=lower(code_value) or (email_value is not null and lower(e.email)=email_value))) then
    raise exception 'employee code or email already exists; import does not update existing employees';
   end if;
   branch_value:=null; department_value:=null; job_value:=null; manager_value:=null;
   if nullif(btrim(coalesce(row_value->>'branch_code','')),'') is not null then
    select b.id into branch_value from public.branches b where b.company_id=c and b.code=upper(btrim(row_value->>'branch_code')) and b.is_active;
    if branch_value is null then raise exception 'branch code is not active in this company'; end if;
   end if;
   if nullif(btrim(coalesce(row_value->>'department_code','')),'') is not null then
    select d.id into department_value from public.departments d where d.company_id=c and d.code=upper(btrim(row_value->>'department_code')) and d.is_active;
    if department_value is null then raise exception 'department code is not active in this company'; end if;
   elsif nullif(btrim(coalesce(row_value->>'department_name','')),'') is not null then
    select d.id into department_value from public.departments d where d.company_id=c and lower(d.name)=lower(btrim(row_value->>'department_name')) and d.is_active;
    if department_value is null then raise exception 'department name is not active in this company'; end if;
   end if;
   if nullif(btrim(coalesce(row_value->>'job_title_code','')),'') is not null then
    select j.id into job_value from public.job_titles j where j.company_id=c and j.code=upper(btrim(row_value->>'job_title_code')) and j.is_active;
    if job_value is null then raise exception 'job title code is not active in this company'; end if;
   elsif nullif(btrim(coalesce(row_value->>'job_title_name','')),'') is not null then
    select j.id into job_value from public.job_titles j where j.company_id=c and lower(j.name)=lower(btrim(row_value->>'job_title_name')) and j.is_active;
    if job_value is null then raise exception 'job title name is not active in this company'; end if;
   end if;
   if nullif(btrim(coalesce(row_value->>'manager_code','')),'') is not null then
    select e.id into manager_value from public.employees e where e.company_id=c and e.employee_code=upper(btrim(row_value->>'manager_code')) and e.deleted_at is null and e.employment_status='active';
    if manager_value is null then raise exception 'manager code is not an active employee in this company'; end if;
   end if;
   role_codes:=array(select upper(btrim(v)) from unnest(string_to_array(coalesce(row_value->>'role_codes',''),',')) v where nullif(btrim(v),'') is not null);
   role_ids:=null;
   if cardinality(role_codes)>0 then
    if not (public.has_permission('employees.assign_roles') or public.has_permission('roles.manage')) then
     if role_codes<>array['EMPLOYEE']::text[] then raise exception 'role assignment requires owner authorization'; end if;
     role_codes:=array[]::text[];
    else
     select array_agg(r.id order by r.code) into role_ids from public.roles r where r.company_id=c and r.code=any(role_codes) and r.is_active;
     if coalesce(cardinality(role_ids),0)<>cardinality(role_codes) then raise exception 'one or more role codes are unavailable in this company'; end if;
     if 'COMPANY_OWNER'=any(role_codes) and not public.has_permission('roles.manage') then raise exception 'only a company owner may assign COMPANY_OWNER'; end if;
     select coalesce(jsonb_agg(to_jsonb(x::text)),'[]'::jsonb) into role_values from unnest(role_ids) x;
    end if;
   end if;
   employee_id:=public.app_save_employee_v2(null,code_value,row_value->>'full_name',row_value->>'phone',email_value,row_value->>'address',branch_value,department_value,job_value,manager_value,
    nullif(row_value->>'hire_date','')::date,coalesce(nullif(row_value->>'salary_type',''),'monthly'),coalesce(nullif(row_value->>'base_salary','')::numeric,0),
    coalesce(nullif(row_value->>'overtime_hour_rate','')::numeric,0),coalesce(nullif(row_value->>'employment_status',''),'active'),role_values);
   inserted_count:=inserted_count+1;
  exception when others then
   failed_count:=failed_count+1;
   errors:=errors||jsonb_build_array(jsonb_build_object('row',row_number,'error',sqlerrm));
  end;
 end loop;
 return jsonb_build_object('inserted',inserted_count,'updated',0,'failed',failed_count,'errors',errors);
end;
$function$;
revoke all on function public.app_import_employees_v2(jsonb) from public,anon;
grant execute on function public.app_import_employees_v2(jsonb) to authenticated;
