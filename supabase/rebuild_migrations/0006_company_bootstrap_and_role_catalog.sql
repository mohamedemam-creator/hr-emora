-- First-party signup foundation for a clean Emora database.
-- The company creation function is server-only; browser clients never receive
-- service_role access and cannot select the target Auth user.

insert into public.permissions(code,module,name,description) values
 ('attendance.adjust','attendance','attendance.adjust','Manual attendance corrections'),
 ('attendance.monitor','attendance','attendance.monitor','Monitor company attendance'),
 ('attendance.review','attendance','attendance.review','Review attendance records'),
 ('attendance.view_branch','attendance','attendance.view_branch','View assigned branch attendance'),
 ('attendance.view_own','attendance','attendance.view_own','View own attendance'),
 ('branches.manage','branches','branches.manage','Manage company branches'),
 ('branches.view_all','branches','branches.view_all','View company branches'),
 ('devices.release','devices','devices.release','Release attendance devices'),
 ('devices.approve','devices','devices.approve','Approve employee attendance browser devices'),
 ('devices.manage','devices','devices.manage','Manage web attendance exceptions and devices'),
 ('devices.reset','devices','devices.reset','Reset attendance devices'),
 ('devices.view','devices','devices.view','View attendance devices'),
 ('employees.assign_roles','employees','employees.assign_roles','Assign company roles to employees'),
 ('employees.delete','employees','employees.delete','Archive company employee records'),
 ('employees.manage','employees','employees.manage','Manage company employees'),
 ('employees.manage_accounts','employees','employees.manage_accounts','Manage employee sign-in accounts'),
 ('employees.view_all','employees','employees.view_all','View company employees'),
 ('employees.view_branch','employees','employees.view_branch','View employees in assigned branches'),
 ('hour_permissions.approve','hour_permissions','hour_permissions.approve','Review company hour permission requests'),
 ('leaves.approve','leaves','leaves.approve','Review company leave requests'),
 ('leaves.manage_types','leaves','leaves.manage_types','Configure company leave types'),
 ('organization.manage','organization','organization.manage','Manage company organizational structure'),
 ('organization.view','organization','organization.view','View company organizational structure'),
 ('notifications.view','notifications','notifications.view','View company notifications'),
 ('payroll.manage','payroll','payroll.manage','Manage company payroll'),
 ('payroll.reopen','payroll','payroll.reopen','Reopen a closed payroll cycle'),
 ('payroll.view','payroll','payroll.view','View company payroll'),
 ('penalties.manage','penalties','penalties.manage','Manage company penalties'),
 ('penalties.approve','penalties','penalties.approve','Approve company penalty requests'),
 ('penalties.view','penalties','penalties.view','View company penalties'),
 ('regions.manage','regions','regions.manage','Manage company regions'),
 ('regions.view_all','regions','regions.view_all','View company regions'),
 ('reports.view','reports','reports.view','View company reports'),
 ('roles.manage','roles','roles.manage','Manage company roles and permissions'),
 ('roles.view','roles','roles.view','View company roles and permissions'),
 ('shifts.manage_branch','shifts','shifts.manage_branch','Manage schedules for assigned branches'),
 ('shifts.manage_past','shifts','shifts.manage_past','Manage past schedules'),
 ('shifts.publish','shifts','shifts.publish','Publish company schedules'),
 ('shifts.view_own','shifts','shifts.view_own','View own shifts')
on conflict(code) do nothing;

create function public.service_bootstrap_company(
 p_user_id uuid,
 p_company_name text,
 p_company_code text,
 p_owner_name text,
 p_employee_code text,
 p_phone text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_user auth.users%rowtype;
 v_company_id uuid;
 v_employee_id uuid;
 v_owner_role_id uuid;
 v_moderator_role_id uuid;
 v_employee_role_id uuid;
 v_area_manager_role_id uuid;
 v_branch_manager_role_id uuid;
 v_membership_id uuid;
begin
 if p_user_id is null then raise exception 'invalid owner'; end if;
 if nullif(btrim(p_company_name),'') is null or length(btrim(p_company_name))>160
    or upper(btrim(coalesce(p_company_code,''))) !~ '^[A-Z0-9_-]{2,20}$'
    or nullif(btrim(p_owner_name),'') is null or length(btrim(p_owner_name))>160
    or upper(btrim(coalesce(p_employee_code,''))) !~ '^[A-Z0-9_-]{2,32}$' then
  raise exception 'invalid company or owner input' using errcode='22023';
 end if;

 select u.* into v_user from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null;
 if not found then raise exception 'verified Auth user required' using errcode='42501'; end if;
 if exists(select 1 from public.platform_admins pa where pa.user_id=p_user_id and pa.revoked_at is null) then
  raise exception 'platform account cannot use public company setup' using errcode='42501';
 end if;
 if exists(select 1 from public.company_memberships cm where cm.user_id=p_user_id) then
  raise exception 'user is already linked to a company' using errcode='42501';
 end if;
 -- An unlinked employee invitation is still a company identity. It must be
 -- accepted, not used to bootstrap an unrelated customer company.
 if exists(select 1 from public.employees e where e.user_id is null and e.deleted_at is null
   and e.employment_status='active' and lower(e.email)=lower(v_user.email)) then
  raise exception 'user has a pending employee invitation' using errcode='42501';
 end if;

 insert into public.companies(name,code)
 values(btrim(p_company_name),upper(btrim(p_company_code))) returning id into v_company_id;

 insert into public.roles(company_id,name,code,description,is_system)
 values(v_company_id,'مالك الشركة','COMPANY_OWNER','Highest authority within this company',true)
 returning id into v_owner_role_id;
 insert into public.roles(company_id,name,code,description,is_system)
 values(v_company_id,'مدير الشركة','COMPANY_MODERATOR','Company-scoped operational administrator',true)
 returning id into v_moderator_role_id;
 insert into public.roles(company_id,name,code,description,is_system)
 values(v_company_id,'موظف','EMPLOYEE','Company employee with self-service access',true)
 returning id into v_employee_role_id;
 insert into public.roles(company_id,name,code,description,is_system)
 values(v_company_id,'أخصائي الموارد البشرية','HR_SPECIALIST','HR role template; company owner must configure its permissions',false);
 insert into public.roles(company_id,name,code,description,is_system)
 values(v_company_id,'مدير المنطقة','AREA_MANAGER','Approves requests for assigned regions',true)
 returning id into v_area_manager_role_id;
 insert into public.roles(company_id,name,code,description,is_system)
 values(v_company_id,'مدير الفرع','BRANCH_MANAGER','Approves requests for assigned branches',true)
 returning id into v_branch_manager_role_id;

 -- Owners receive the company permission catalog; this remains company-scoped
 -- and does not grant platform authority.
 insert into public.role_permissions(role_id,permission_id,scope_level)
 select v_owner_role_id,p.id,'company' from public.permissions p
 on conflict do nothing;

 -- The default moderator can operate employees, branches, schedules, and
 -- attendance, but does not manage roles, payroll, or platform identity.
 insert into public.role_permissions(role_id,permission_id,scope_level)
 select v_moderator_role_id,p.id,'company' from public.permissions p
 where p.code = any(array[
  'attendance.adjust','attendance.monitor','attendance.review','attendance.view_branch',
  'branches.manage','branches.view_all','devices.release','devices.reset','devices.view',
  'employees.manage','employees.manage_accounts','employees.view_all',
  'employees.view_branch','leaves.approve','hour_permissions.approve','organization.manage','organization.view','notifications.view',
  'devices.manage','penalties.manage','penalties.view','regions.manage','regions.view_all','reports.view',
  'shifts.manage_branch','shifts.manage_past','shifts.publish'
 ]) on conflict do nothing;
 insert into public.role_permissions(role_id,permission_id,scope_level)
 select v_employee_role_id,p.id,'own' from public.permissions p
 where p.code=any(array['attendance.view_own','shifts.view_own'])
 on conflict do nothing;
 -- Scoped approval grants are usable only when has_permission receives a
 -- database-derived request branch/region and the reviewer has that scope.
 insert into public.role_permissions(role_id,permission_id,scope_level)
 select v_branch_manager_role_id,p.id,'branch' from public.permissions p
 where p.code=any(array['leaves.approve','hour_permissions.approve'])
 on conflict do nothing;
 insert into public.role_permissions(role_id,permission_id,scope_level)
 select v_area_manager_role_id,p.id,'region' from public.permissions p
 where p.code=any(array['leaves.approve','hour_permissions.approve'])
 on conflict do nothing;

 insert into public.profiles(user_id,full_name,phone)
 values(p_user_id,btrim(p_owner_name),nullif(btrim(p_phone),''))
 on conflict(user_id) do update set full_name=excluded.full_name,
  phone=coalesce(excluded.phone,public.profiles.phone),updated_at=clock_timestamp();

 insert into public.employees(company_id,user_id,employee_code,full_name,phone,email,employment_status,login_enabled)
 values(v_company_id,p_user_id,upper(btrim(p_employee_code)),btrim(p_owner_name),nullif(btrim(p_phone),''),lower(v_user.email),'active',true)
 returning id into v_employee_id;
 insert into public.employee_roles(employee_id,role_id) values(v_employee_id,v_owner_role_id);

 select cm.id into v_membership_id from public.company_memberships cm
 where cm.company_id=v_company_id and cm.user_id=p_user_id and cm.employee_id=v_employee_id and cm.status='active';
 if v_membership_id is null then raise exception 'owner membership bootstrap failed' using errcode='P0001'; end if;

 insert into public.payroll_settings(company_id) values(v_company_id) on conflict(company_id) do nothing;
 -- Initial neutral leave categories keep signup usable without hard-coding
 -- statutory entitlements; company owners can rename, deactivate, or configure
 -- annual days through the leave-type settings RPC.
 insert into public.leave_types(company_id,name,code,is_paid,requires_attachment,annual_entitlement,is_active)
 values(v_company_id,'إجازة مدفوعة','PAID',true,false,null,true),
       (v_company_id,'إجازة غير مدفوعة','UNPAID',false,false,null,true)
 on conflict(company_id,code) do nothing;
 insert into public.audit_logs(actor_user_id,actor_membership_id,actor_employee_id,actor_company_role,
   company_id,action,category,entity_type,entity_id,status,new_data,context)
 values(p_user_id,v_membership_id,v_employee_id,'COMPANY_OWNER',v_company_id,'company.created','company',
   'company',v_company_id,'success',jsonb_build_object('name',btrim(p_company_name),'code',upper(btrim(p_company_code))),
   jsonb_build_object('source','service_bootstrap_company'));

 return jsonb_build_object('company_id',v_company_id,'employee_id',v_employee_id);
end;
$$;
revoke all on function public.service_bootstrap_company(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.service_bootstrap_company(uuid,text,text,text,text,text) to service_role;

comment on function public.service_bootstrap_company(uuid,text,text,text,text,text) is
 'Server-only verified-signup bootstrap. Requires a confirmed Auth user with no company membership, no platform identity, and no pending employee invite.';

create function public.app_platform_list_companies()
returns table(id uuid,name text,code text,status text,timezone text,created_at timestamptz)
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not app_private.is_platform_admin() then
  raise exception 'platform administrator authorization required' using errcode='42501';
 end if;
 insert into public.audit_logs(actor_user_id,actor_platform_admin_id,actor_platform_role,actor_platform_admin,
   action,category,entity_type,status,context)
 values(auth.uid(),auth.uid(),'PLATFORM_SUPER_ADMIN',true,'platform.company.listed','access',
   'company_directory','success',jsonb_build_object('source','app_platform_list_companies'));
 return query select c.id,c.name,c.code,c.status,c.timezone,c.created_at
  from public.companies c order by c.name,c.code;
end;
$$;
revoke all on function public.app_platform_list_companies() from public,anon;
grant execute on function public.app_platform_list_companies() to authenticated;

create function public.app_platform_update_company(
 p_company_id uuid,p_name text,p_status text,p_timezone text
) returns public.companies
language plpgsql security definer set search_path=''
as $$
declare old_company public.companies; new_company public.companies;
begin
 if auth.uid() is null or not app_private.is_platform_admin() then
  raise exception 'platform administrator authorization required' using errcode='42501';
 end if;
 if p_company_id is null or nullif(btrim(p_name),'') is null or length(btrim(p_name))>160
   or p_status not in ('active','suspended','closed')
   or nullif(btrim(p_timezone),'') is null then
  raise exception 'invalid company update' using errcode='22023';
 end if;
 select c.* into old_company from public.companies c where c.id=p_company_id for update;
 if not found then raise exception 'company not found' using errcode='P0002'; end if;
 update public.companies c set name=btrim(p_name),status=p_status,timezone=btrim(p_timezone),updated_at=clock_timestamp()
 where c.id=p_company_id returning c.* into new_company;
 insert into public.audit_logs(actor_user_id,actor_platform_admin_id,actor_platform_role,actor_platform_admin,
   company_id,action,category,entity_type,entity_id,status,old_data,new_data,context)
 values(auth.uid(),auth.uid(),'PLATFORM_SUPER_ADMIN',true,p_company_id,'platform.company.updated','company',
   'company',p_company_id,'success',
   jsonb_build_object('name',old_company.name,'status',old_company.status,'timezone',old_company.timezone),
   jsonb_build_object('name',new_company.name,'status',new_company.status,'timezone',new_company.timezone),
   jsonb_build_object('source','app_platform_update_company'));
 return new_company;
end;
$$;
revoke all on function public.app_platform_update_company(uuid,text,text,text) from public,anon;
grant execute on function public.app_platform_update_company(uuid,text,text,text) to authenticated;
