-- RLS default-deny and the current frontend app_current_access contract.
-- Other application RPCs need their own authorization and audit implementations.

-- The live base table predates the role-scoped column in the current 0001 file.
-- Add it only when absent. Never guess a role for existing scope rows: fail
-- closed if rows need a reviewed mapping before enforcing the role foreign key.
do $$
begin
 if not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='employee_scope_assignments' and column_name='role_id'
 ) then
  if exists(select 1 from public.employee_scope_assignments) then
   raise exception 'employee_scope_assignments has rows but no role_id; map scopes to roles before applying 0005';
  end if;
  alter table public.employee_scope_assignments add column role_id uuid;
 end if;

 if exists(select 1 from public.employee_scope_assignments where role_id is null) then
  raise exception 'employee_scope_assignments contains null role_id values; resolve them before applying 0005';
 end if;
 alter table public.employee_scope_assignments alter column role_id set not null;

 if not exists (
  select 1 from pg_constraint c
  where c.contype='f'
   and c.conrelid='public.employee_scope_assignments'::regclass
   and c.confrelid='public.employee_roles'::regclass
   and (select array_agg(a.attname order by k.ord)
        from unnest(c.conkey) with ordinality k(attnum,ord)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
       = array['employee_id','role_id']::name[]
   and (select array_agg(a.attname order by k.ord)
        from unnest(c.confkey) with ordinality k(attnum,ord)
        join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)
       = array['employee_id','role_id']::name[]
 ) then
  alter table public.employee_scope_assignments
   add constraint employee_scope_assignments_employee_role_fk
   foreign key(employee_id,role_id)
   references public.employee_roles(employee_id,role_id) on delete cascade;
 end if;
end;
$$;
create index if not exists employee_scope_role_lookup_idx
 on public.employee_scope_assignments(employee_id,role_id,scope_level,scope_id);

-- Profile text is copied from user-editable metadata only for display. No access
-- decision in this migration reads Auth user_metadata.
create or replace function app_private.sync_auth_profile()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.profiles(user_id,full_name)
 values(new.id,coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),nullif(split_part(coalesce(new.email,''),'@',1),''),'User'))
 on conflict(user_id) do update set
  full_name=case when nullif(btrim(new.raw_user_meta_data->>'full_name'),'') is not null
    then btrim(new.raw_user_meta_data->>'full_name') else public.profiles.full_name end,
  updated_at=clock_timestamp();
 return new;
end; $$;
revoke all on function app_private.sync_auth_profile() from public,anon,authenticated;
drop trigger if exists auth_profile_sync on auth.users;
create trigger auth_profile_sync after insert or update of raw_user_meta_data on auth.users
for each row execute function app_private.sync_auth_profile();

create or replace function app_private.is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and exists (
 select 1 from public.platform_admins p where p.user_id=(select auth.uid()) and p.revoked_at is null
); $$;
revoke all on function app_private.is_platform_admin() from public,anon;
grant execute on function app_private.is_platform_admin() to authenticated,service_role;

create or replace function app_private.check_employee_role_company()
returns trigger language plpgsql security definer set search_path=''
as $$
declare e_company uuid; r_company uuid;
begin
 select company_id into e_company from public.employees where id=new.employee_id;
 select company_id into r_company from public.roles where id=new.role_id;
 if e_company is null or r_company is null or e_company<>r_company then
  raise exception 'employee and role must belong to the same company' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function app_private.check_employee_role_company() from public,anon,authenticated;
drop trigger if exists employee_roles_company_guard on public.employee_roles;
create trigger employee_roles_company_guard before insert or update on public.employee_roles
for each row execute function app_private.check_employee_role_company();

create or replace function app_private.check_scope_assignment()
returns trigger language plpgsql security definer set search_path=''
as $$
declare found_target boolean:=false;
begin
 case new.scope_level
  when 'company' then found_target:=new.scope_id is null;
  when 'own' then found_target:=new.scope_id=new.employee_id;
  when 'region' then select exists(select 1 from public.regions where id=new.scope_id and company_id=new.company_id) into found_target;
  when 'branch' then select exists(select 1 from public.branches where id=new.scope_id and company_id=new.company_id) into found_target;
  when 'department' then select exists(select 1 from public.departments where id=new.scope_id and company_id=new.company_id) into found_target;
 end case;
 if not found_target then raise exception 'scope target must exist in the employee company' using errcode='23514'; end if;
 return new;
end; $$;
revoke all on function app_private.check_scope_assignment() from public,anon,authenticated;
drop trigger if exists employee_scope_company_guard on public.employee_scope_assignments;
create trigger employee_scope_company_guard before insert or update on public.employee_scope_assignments
for each row execute function app_private.check_scope_assignment();

create or replace function app_private.sync_employee_membership()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if tg_op='UPDATE' and old.user_id is not null and
   (old.user_id is distinct from new.user_id or old.company_id is distinct from new.company_id) then
  update public.company_memberships set status='ended',employee_id=null
   where company_id=old.company_id and user_id=old.user_id and employee_id=old.id;
 end if;
 if new.user_id is not null then
  insert into public.company_memberships(company_id,user_id,employee_id,status,joined_at)
   values(new.company_id,new.user_id,new.id,
    case when new.employment_status='active' and new.login_enabled then 'active' else 'suspended' end,
    case when new.employment_status='active' and new.login_enabled then now() else null end)
   on conflict(company_id,user_id) do update set employee_id=excluded.employee_id,status=excluded.status;
  insert into public.user_company_context(user_id,company_id) values(new.user_id,new.company_id)
   on conflict(user_id) do nothing;
 end if;
 return new;
end; $$;
revoke all on function app_private.sync_employee_membership() from public,anon,authenticated;
drop trigger if exists employee_membership_sync on public.employees;
create trigger employee_membership_sync after insert or update of user_id,company_id,employment_status,login_enabled
on public.employees for each row execute function app_private.sync_employee_membership();

create or replace function public.app_select_company(p_company_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid(); m uuid; role_at_time text;
begin
 if u is null then raise exception 'authentication required' using errcode='28000'; end if;
 select cm.id,string_agg(distinct r.code,',' order by r.code) into m,role_at_time
  from public.company_memberships cm
  left join public.employee_roles er on er.employee_id=cm.employee_id
  left join public.roles r on r.id=er.role_id and r.company_id=cm.company_id
  where cm.user_id=u and cm.company_id=p_company_id and cm.status='active'
  group by cm.id;
 if m is null then raise exception 'active company membership required' using errcode='42501'; end if;
 insert into public.user_company_context(user_id,company_id,updated_at)
  values(u,p_company_id,clock_timestamp()) on conflict(user_id)
  do update set company_id=excluded.company_id,updated_at=excluded.updated_at;
 insert into public.audit_logs(actor_user_id,actor_membership_id,actor_company_role,company_id,action,category,entity_type,entity_id,status,context)
  values(u,m,role_at_time,p_company_id,'company.context.selected','access','company',p_company_id,'success','{"source":"app_select_company"}'::jsonb);
end; $$;
revoke all on function public.app_select_company(uuid) from public,anon;
grant execute on function public.app_select_company(uuid) to authenticated;

create or replace function public.app_platform_select_company(p_company_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare u uuid:=auth.uid();
begin
 if u is null or not app_private.is_platform_admin() then
  raise exception 'platform administrator authorization required' using errcode='42501';
 end if;
 if not exists(select 1 from public.companies c where c.id=p_company_id and c.status='active') then
  raise exception 'active company required' using errcode='22023';
 end if;
 insert into public.platform_admin_context(user_id,company_id,updated_at)
  values(u,p_company_id,clock_timestamp()) on conflict(user_id)
  do update set company_id=excluded.company_id,updated_at=excluded.updated_at;
 insert into public.audit_logs(actor_user_id,actor_platform_admin_id,actor_platform_role,actor_platform_admin,
    company_id,action,category,entity_type,entity_id,status,context)
  values(u,u,'PLATFORM_SUPER_ADMIN',true,p_company_id,'platform.company.accessed','access','company',p_company_id,
    'success','{"source":"app_platform_select_company"}'::jsonb);
end; $$;
revoke all on function public.app_platform_select_company(uuid) from public,anon;
grant execute on function public.app_platform_select_company(uuid) to authenticated;

create or replace function public.insert_branch_with_location(
 p_company_id uuid,p_region_id uuid,p_name text,p_code text,p_address text,
 p_latitude double precision,p_longitude double precision,p_radius integer,
 p_accuracy_limit integer default 100
)
returns public.branches language plpgsql security definer set search_path=''
as $$
declare b public.branches;
begin
 if p_latitude is null or p_latitude not between -90 and 90 or
    p_longitude is null or p_longitude not between -180 and 180 then
  raise exception 'invalid coordinates' using errcode='22023';
 end if;
 if not exists(select 1 from public.regions r where r.id=p_region_id and r.company_id=p_company_id) then
  raise exception 'region must belong to company' using errcode='23503';
 end if;
 insert into public.branches(company_id,region_id,name,code,address,location,attendance_radius_m,minimum_gps_accuracy_m)
 values(p_company_id,p_region_id,trim(p_name),upper(trim(p_code)),nullif(trim(p_address),''),
   extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,
   p_radius,p_accuracy_limit)
 returning * into b;
 return b;
end; $$;
revoke all on function public.insert_branch_with_location(uuid,uuid,text,text,text,double precision,double precision,integer,integer)
 from public,anon,authenticated;
grant execute on function public.insert_branch_with_location(uuid,uuid,text,text,text,double precision,double precision,integer,integer)
 to service_role;

-- Company helpers intentionally exclude platform context: platform operations use
-- separate, explicitly platform-checked APIs and never impersonate membership.
create or replace function public.current_company_id()
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare u uuid:=auth.uid(); c uuid; membership_count integer;
begin
 if u is null then return null; end if;
 select x.company_id into c from public.user_company_context x
  join public.company_memberships m on m.company_id=x.company_id and m.user_id=x.user_id and m.status='active'
  where x.user_id=u;
 if c is not null then return c; end if;
 select count(*)::integer into membership_count from public.company_memberships where user_id=u and status='active';
 if membership_count=1 then
  select company_id into c from public.company_memberships where user_id=u and status='active' limit 1;
  return c;
 end if;
 return null;
end; $$;
revoke all on function public.current_company_id() from public,anon;
grant execute on function public.current_company_id() to authenticated;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path=''
as $$
 select m.employee_id from public.company_memberships m
 join public.employees e on e.id=m.employee_id and e.company_id=m.company_id
 where m.user_id=(select auth.uid()) and m.company_id=public.current_company_id()
   and m.status='active' and e.employment_status='active' and e.login_enabled
 limit 1;
$$;
revoke all on function public.current_employee_id() from public,anon;
grant execute on function public.current_employee_id() to authenticated;

create or replace function public.has_permission(
 p_permission_code text,p_branch_id uuid,p_region_id uuid,p_role_code text
)
returns boolean language sql stable security definer set search_path=''
as $$
 with actor as (
  select public.current_employee_id() as employee_id,public.current_company_id() as company_id
 )
 select exists(
  select 1 from actor a
  join public.employee_roles er on er.employee_id=a.employee_id
  join public.roles r on r.id=er.role_id and r.company_id=a.company_id
  where a.employee_id is not null and r.is_active and r.code='COMPANY_OWNER'
    and (p_role_code is null or p_role_code='COMPANY_OWNER')
 ) or exists(
  select 1 from actor a
  join public.employee_roles er on er.employee_id=a.employee_id
  join public.roles r on r.id=er.role_id and r.company_id=a.company_id and r.is_active
  join public.role_permissions rp on rp.role_id=r.id
  join public.permissions p on p.id=rp.permission_id and p.code=p_permission_code
  where a.employee_id is not null and (p_role_code is null or r.code=p_role_code)
   and (p_role_code is null
     or (p_role_code='BRANCH_MANAGER' and rp.scope_level='branch')
     or (p_role_code='AREA_MANAGER' and rp.scope_level='region')
     or (p_role_code='COMPANY_OWNER' and rp.scope_level='company'))
   and (
   rp.scope_level='company'
   or (rp.scope_level='branch' and p_branch_id is not null and exists(
    select 1 from public.branches b
    where b.id=p_branch_id and b.company_id=a.company_id and (
     exists(select 1 from public.employee_scope_assignments esa where esa.employee_id=a.employee_id
       and esa.role_id=er.role_id and esa.company_id=a.company_id and esa.scope_level='branch' and esa.scope_id=b.id)
    )
   ))
   or (rp.scope_level='region' and p_region_id is not null and exists(
    select 1 from public.regions rg
    where rg.id=p_region_id and rg.company_id=a.company_id
      and (p_branch_id is null or exists(select 1 from public.branches b
        where b.id=p_branch_id and b.company_id=a.company_id and b.region_id=rg.id))
      and (
       exists(select 1 from public.employee_scope_assignments esa where esa.employee_id=a.employee_id
         and esa.role_id=er.role_id and esa.company_id=a.company_id and esa.scope_level='region' and esa.scope_id=rg.id)
      )
   ))
  )
 );
$$;
revoke all on function public.has_permission(text,uuid,uuid,text) from public,anon;
grant execute on function public.has_permission(text,uuid,uuid,text) to authenticated;

create or replace function public.has_permission(p_permission_code text,p_branch_id uuid,p_region_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select public.has_permission(p_permission_code,p_branch_id,p_region_id,null::text) $$;
revoke all on function public.has_permission(text,uuid,uuid) from public,anon;
grant execute on function public.has_permission(text,uuid,uuid) to authenticated;

-- Preserve existing company-wide call sites. Scoped grants require callers to
-- supply the database-validated branch/region being authorized.
create or replace function public.has_permission(p_permission_code text)
returns boolean language sql stable security definer set search_path=''
as $$ select public.has_permission(p_permission_code,null::uuid,null::uuid,null::text) $$;
revoke all on function public.has_permission(text) from public,anon;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.app_current_access()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare u uuid:=auth.uid(); c uuid; pc uuid; e uuid; n text; platform_admin boolean;
perms jsonb:='[]'::jsonb; rs jsonb:='[]'::jsonb; ms jsonb:='[]'::jsonb; mc integer:=0;
begin
 if u is null then raise exception 'authentication required' using errcode='28000'; end if;
 platform_admin:=app_private.is_platform_admin();
 select coalesce(jsonb_agg(jsonb_build_object('company_id',m.company_id,'company_name',co.name)
        order by co.name),'[]'::jsonb),count(*)::integer into ms,mc
  from public.company_memberships m join public.companies co on co.id=m.company_id
  where m.user_id=u and m.status='active';
 if platform_admin then
  select pac.company_id into pc from public.platform_admin_context pac where pac.user_id=u;
 end if;
 select x.company_id into c from public.user_company_context x
 join public.company_memberships m on m.user_id=x.user_id and m.company_id=x.company_id and m.status='active'
 where x.user_id=u;
 if c is null and mc=1 then
  select company_id into c from public.company_memberships where user_id=u and status='active' limit 1;
 end if;
 if c is not null then
  select emp.id,coalesce(emp.full_name,p.full_name) into e,n
   from public.company_memberships m left join public.employees emp on emp.id=m.employee_id and emp.company_id=m.company_id
   left join public.profiles p on p.user_id=m.user_id
   where m.user_id=u and m.company_id=c and m.status='active';
  select coalesce(jsonb_agg(distinct jsonb_build_object('id',r.id,'name',r.name,'code',r.code)),'[]'::jsonb),
         coalesce(jsonb_agg(distinct pe.code) filter(where pe.code is not null and public.has_permission(pe.code,emp.branch_id,access_branch.region_id)),'[]'::jsonb)
   into rs,perms from public.employee_roles er
   join public.employees emp on emp.id=er.employee_id and emp.company_id=c and emp.user_id=u
   join public.roles r on r.id=er.role_id and r.company_id=c and r.is_active
   left join public.role_permissions rp on rp.role_id=r.id
   left join public.permissions pe on pe.id=rp.permission_id
   left join public.branches access_branch on access_branch.id=emp.branch_id and access_branch.company_id=c;
 end if;
 return jsonb_build_object('employee_id',e,'company_id',c,'full_name',n,
  'permissions',perms,'roles',rs,'is_platform_admin',platform_admin,'memberships',ms,
  'platform_context',case when platform_admin then jsonb_build_object(
    'role','PLATFORM_SUPER_ADMIN','selected_company_id',pc) else null end);
end; $$;
revoke all on function public.app_current_access() from public,anon;
grant execute on function public.app_current_access() to authenticated;

create or replace function public.app_clear_password_change_flag()
returns void language plpgsql security definer set search_path=''
as $$ begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
 update public.employees set must_change_password=false,updated_at=clock_timestamp()
  where user_id=auth.uid() and must_change_password;
end; $$;
revoke all on function public.app_clear_password_change_flag() from public,anon;
grant execute on function public.app_clear_password_change_flag() to authenticated;

-- Revoke direct browser table access; RPCs are the only intended public data API.
do $$
declare t record;
begin
 for t in select tablename from pg_catalog.pg_tables where schemaname='public' and tablename<>'spatial_ref_sys' loop
  execute format('alter table public.%I enable row level security',t.tablename);
  execute format('revoke all on table public.%I from public,anon,authenticated',t.tablename);
  execute format('grant all on table public.%I to service_role',t.tablename);
 end loop;
end; $$;
revoke all on all sequences in schema public from public,anon,authenticated;
grant usage,select on all sequences in schema public to service_role;
revoke all on public.user_company_context,public.platform_admin_context from public,anon,authenticated,service_role;

create or replace function app_private.prevent_audit_mutation()
returns trigger language plpgsql set search_path=''
as $$ begin raise exception 'audit records are append-only' using errcode='42501'; end; $$;
revoke all on function app_private.prevent_audit_mutation() from public,anon,authenticated;
drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only before update or delete on public.audit_logs
for each row execute function app_private.prevent_audit_mutation();

-- Platform administrator assignment is reserved to a trusted database-owner process.
revoke all on public.platform_admins from public,anon,authenticated,service_role;
