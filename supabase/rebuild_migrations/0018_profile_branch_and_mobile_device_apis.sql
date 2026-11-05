-- Additive APIs for personal profile reads, branch manager assignments, and
-- mobile-device registration/activation. No existing rows are removed.

alter table public.branches add column if not exists manager_employee_id uuid;
do $$
begin
 if not exists (
  select 1 from pg_constraint
  where conrelid='public.branches'::regclass
    and conname='branches_manager_company_fk'
 ) then
  alter table public.branches add constraint branches_manager_company_fk
   foreign key(manager_employee_id,company_id)
   references public.employees(id,company_id) on delete set null (manager_employee_id);
 end if;
end;
$$;

-- Bring existing secure iOS browser records into the shared activation model.
insert into public.mobile_devices(company_id,employee_id,device_id,status)
select ios.company_id,ios.employee_id,ios.device_id,ios.status
from (
 select distinct on(company_id,device_id) company_id,employee_id,device_id,status,updated_at
 from public.ios_web_devices where device_id is not null
 order by company_id,device_id,updated_at desc
) as ios
where not exists(select 1 from public.mobile_devices as mobile
 where mobile.company_id=ios.company_id and mobile.device_id=ios.device_id);
insert into public.mobile_devices(company_id,employee_id,device_id,status)
select pending.company_id,pending.employee_id,pending.device_id,'released'
from (
 select distinct on(company_id,device_id) company_id,employee_id,device_id,requested_at
 from public.ios_web_device_requests where status='pending'
 order by company_id,device_id,requested_at desc
) as pending
where not exists(select 1 from public.mobile_devices as mobile
 where mobile.company_id=pending.company_id and mobile.device_id=pending.device_id);

create function public.app_my_profile() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'authentication required' using errcode='28000'; end if;
 select jsonb_build_object(
  'full_name',coalesce(p.full_name,emp.full_name,auth.jwt()->'user_metadata'->>'full_name',auth.jwt()->'user_metadata'->>'name'),
  'phone',coalesce(p.phone,emp.phone,auth.jwt()->'user_metadata'->>'phone')
 ) into result
 from (select u as user_id) actor
 left join public.profiles p on p.user_id=actor.user_id
 left join public.employees emp on emp.user_id=actor.user_id
  and emp.company_id=public.current_company_id() and emp.deleted_at is null;
 return coalesce(result,'{}'::jsonb);
end; $$;
revoke all on function public.app_my_profile() from public,anon;
grant execute on function public.app_my_profile() to authenticated;

create function public.app_list_branches_with_managers()
returns table(
 id uuid,region_id uuid,region_name text,region_code text,
 region_manager_employee_id uuid,region_manager_name text,
 manager_employee_id uuid,manager_name text,
 name text,code text,address text,latitude double precision,longitude double precision,
 attendance_radius_m integer,minimum_gps_accuracy_m integer,is_active boolean,
 employee_count bigint,created_at timestamptz,updated_at timestamptz
)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('branches.view_all');
begin
 return query select b.id,b.region_id,r.name,r.code,r.manager_employee_id,area_manager.full_name,
  b.manager_employee_id,branch_manager.full_name,b.name,b.code,b.address,
  case when b.location is null then null else extensions.st_y(b.location::extensions.geometry) end,
  case when b.location is null then null else extensions.st_x(b.location::extensions.geometry) end,
  b.attendance_radius_m,b.minimum_gps_accuracy_m,b.is_active,
  (select count(*) from public.employees e where e.company_id=c and e.branch_id=b.id and e.deleted_at is null),
  b.created_at,b.updated_at
 from public.branches b
 left join public.regions r on r.id=b.region_id and r.company_id=b.company_id
 left join public.employees area_manager on area_manager.id=r.manager_employee_id and area_manager.company_id=c
 left join public.employees branch_manager on branch_manager.id=b.manager_employee_id and branch_manager.company_id=c
 where b.company_id=c order by r.name,b.name;
end; $$;
revoke all on function public.app_list_branches_with_managers() from public,anon;
grant execute on function public.app_list_branches_with_managers() to authenticated;

create function public.app_save_branch_with_managers(
 p_branch_id uuid,p_region_id uuid,p_region_manager_employee_id uuid,p_branch_manager_employee_id uuid,
 p_region_name text,p_region_code text,p_branch_name text,p_branch_code text,p_address text,
 p_latitude double precision,p_longitude double precision,p_radius integer,p_accuracy_limit integer,p_is_active boolean
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 c uuid:=app_private.require_company_permission('branches.manage');
 rid uuid:=p_region_id; bid uuid:=p_branch_id; old_row public.branches; old_region_manager uuid;
begin
 if nullif(btrim(p_branch_name),'') is null or upper(btrim(coalesce(p_branch_code,''))) !~ '^[A-Z0-9_-]{1,32}$'
  or p_latitude is null or p_latitude not between -90 and 90
  or p_longitude is null or p_longitude not between -180 and 180
  or p_radius not between 25 and 1000 or p_accuracy_limit not between 1 and 1000 then
  raise exception 'invalid branch details or location' using errcode='22023';
 end if;
 if p_region_manager_employee_id is null or not exists(
  select 1 from public.employees e where e.id=p_region_manager_employee_id and e.company_id=c
   and e.employment_status='active' and e.deleted_at is null
 ) then raise exception 'active area manager from this company is required' using errcode='23503'; end if;
 if not public.has_permission('regions.manage') then
  raise exception 'region manager assignment permission required' using errcode='42501';
 end if;
 if p_branch_manager_employee_id is null or not exists(
  select 1 from public.employees e where e.id=p_branch_manager_employee_id and e.company_id=c
   and e.employment_status='active' and e.deleted_at is null
 ) then raise exception 'active branch manager from this company is required' using errcode='23503'; end if;

 if rid is null then
  if nullif(btrim(p_region_name),'') is null or upper(btrim(coalesce(p_region_code,''))) !~ '^[A-Z0-9_-]{1,32}$' then
   raise exception 'region selection is required' using errcode='22023';
  end if;
  insert into public.regions(company_id,name,code,manager_employee_id)
   values(c,btrim(p_region_name),upper(btrim(p_region_code)),p_region_manager_employee_id)
   on conflict(company_id,code) do update set name=excluded.name,manager_employee_id=excluded.manager_employee_id
   returning id into rid;
 else
  if not exists(select 1 from public.regions r where r.id=rid and r.company_id=c and r.is_active) then
   raise exception 'region is outside current company' using errcode='42501';
  end if;
  select r.manager_employee_id into old_region_manager from public.regions r where r.id=rid and r.company_id=c for update;
  update public.regions set manager_employee_id=p_region_manager_employee_id,updated_at=clock_timestamp()
   where id=rid and company_id=c;
 end if;

 if bid is null then
  insert into public.branches(company_id,region_id,manager_employee_id,name,code,address,location,
   attendance_radius_m,minimum_gps_accuracy_m,is_active)
  values(c,rid,p_branch_manager_employee_id,btrim(p_branch_name),upper(btrim(p_branch_code)),
   nullif(btrim(p_address),''),extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,
   p_radius,p_accuracy_limit,coalesce(p_is_active,true)) returning id into bid;
 else
  select b.* into old_row from public.branches b where b.id=bid and b.company_id=c for update;
  if not found then raise exception 'branch is outside current company' using errcode='42501'; end if;
  update public.branches b set region_id=rid,manager_employee_id=p_branch_manager_employee_id,
   name=btrim(p_branch_name),code=upper(btrim(p_branch_code)),address=nullif(btrim(p_address),''),
   location=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,
   attendance_radius_m=p_radius,minimum_gps_accuracy_m=p_accuracy_limit,
   is_active=coalesce(p_is_active,b.is_active),updated_at=clock_timestamp()
   where b.id=bid and b.company_id=c;
 end if;
 perform app_private.audit_company_action(c,
  case when p_branch_id is null then 'branch.created' else 'branch.updated' end,'branch',bid,
  case when p_branch_id is null then null else jsonb_build_object('region_id',old_row.region_id,
   'region_manager_employee_id',old_region_manager,'manager_employee_id',old_row.manager_employee_id,
   'name',old_row.name,'code',old_row.code) end,
  jsonb_build_object('region_id',rid,'region_manager_employee_id',p_region_manager_employee_id,
   'manager_employee_id',p_branch_manager_employee_id,'name',btrim(p_branch_name),'code',upper(btrim(p_branch_code))));
 return bid;
end; $$;
revoke all on function public.app_save_branch_with_managers(uuid,uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,integer,integer,boolean) from public,anon;
grant execute on function public.app_save_branch_with_managers(uuid,uuid,uuid,uuid,text,text,text,text,text,double precision,double precision,integer,integer,boolean) to authenticated;

create function public.app_my_mobile_device_status() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); d public.mobile_devices;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select * into d from public.mobile_devices where company_id=c and employee_id=e order by updated_at desc limit 1;
 return jsonb_build_object('has_device',d.id is not null,'status',coalesce(d.status,'none'),
  'device_id_short',case when d.device_id is null then null else right(d.device_id,8) end);
end; $$;
revoke all on function public.app_my_mobile_device_status() from public,anon;
grant execute on function public.app_my_mobile_device_status() to authenticated;

create function public.app_my_web_attendance_access_for_device(p_device_id text) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); allowed_value boolean:=false; pending_value boolean:=false;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select exists(select 1 from public.web_attendance_exceptions as web_exception
  where web_exception.company_id=c and web_exception.employee_id=e and web_exception.enabled)
  or exists(select 1 from public.mobile_devices as mobile_device
  where mobile_device.company_id=c and mobile_device.employee_id=e and mobile_device.device_id=p_device_id and mobile_device.status='active')
  or (exists(select 1 from public.ios_web_devices as ios_device
   where ios_device.company_id=c and ios_device.employee_id=e and ios_device.device_id=p_device_id and ios_device.status='active')
   and exists(select 1 from public.mobile_devices as mobile_device
   where mobile_device.company_id=c and mobile_device.employee_id=e and mobile_device.device_id=p_device_id and mobile_device.status='active'))
 into allowed_value;
 select exists(select 1 from public.mobile_devices as mobile_device
  where mobile_device.company_id=c and mobile_device.employee_id=e and mobile_device.device_id=p_device_id and mobile_device.status='released')
 into pending_value;
 return jsonb_build_object('allowed',allowed_value,'pending',pending_value);
end; $$;
revoke all on function public.app_my_web_attendance_access_for_device(text) from public,anon;
grant execute on function public.app_my_web_attendance_access_for_device(text) to authenticated;

create function public.app_request_my_mobile_device(p_device_id text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); d public.mobile_devices; old_status text; old_employee uuid;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 if nullif(btrim(p_device_id),'') is null or length(p_device_id)>160 then raise exception 'invalid device fingerprint' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||':'||p_device_id,0));
 select * into d from public.mobile_devices where company_id=c and device_id=p_device_id order by updated_at desc limit 1 for update;
 old_status:=d.status; old_employee:=d.employee_id;
 if d.id is not null and d.status='active' then
  if d.employee_id<>e then raise exception 'device is already active for another employee' using errcode='23505'; end if;
  if left(p_device_id,4)='ios:' and exists(select 1 from public.ios_web_device_requests as request
   where request.company_id=c and request.employee_id=e and request.device_id=p_device_id and request.status='pending') then
   update public.mobile_devices set status='released',updated_at=clock_timestamp() where id=d.id and company_id=c;
   perform app_private.audit_company_action(c,'device.mobile_reactivation_requested','mobile_device',d.id,
    jsonb_build_object('status','active'),jsonb_build_object('status','released','device_id_suffix',right(p_device_id,8)));
   return jsonb_build_object('status','released');
  end if;
  return jsonb_build_object('status','active');
 end if;
 if d.id is not null and d.status='revoked' then return jsonb_build_object('status','revoked'); end if;
 if d.id is not null and d.status='released' and d.employee_id=e then
  return jsonb_build_object('status','released');
 end if;
 if exists(select 1 from public.mobile_devices where company_id=c and device_id=p_device_id and status='active') then
  raise exception 'device is already active for another employee' using errcode='23505';
 end if;
 if d.id is null then
  insert into public.mobile_devices(company_id,employee_id,device_id,status)
   values(c,e,p_device_id,'released') returning * into d;
 else
  update public.mobile_devices set employee_id=e,status='released',updated_at=clock_timestamp()
   where id=d.id and company_id=c returning * into d;
 end if;
 perform app_private.audit_company_action(c,'device.mobile_activation_requested','mobile_device',d.id,
  case when old_status is null then null else jsonb_build_object('status',old_status,'employee_id',old_employee) end,
  jsonb_build_object('device_id_suffix',right(p_device_id,8),'status','released'));
 return jsonb_build_object('status','released');
end; $$;
revoke all on function public.app_request_my_mobile_device(text) from public,anon;
grant execute on function public.app_request_my_mobile_device(text) to authenticated;

create or replace function public.app_employee_mobile_device_status(p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.view'); d public.mobile_devices;
 can_reset_value boolean:=public.has_permission('devices.reset');
 can_release_value boolean:=public.has_permission('devices.release');
 can_activate_value boolean:=public.has_permission('devices.approve');
begin
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=c) then
  raise exception 'employee is outside company' using errcode='42501';
 end if;
 select * into d from public.mobile_devices where company_id=c and employee_id=p_employee_id order by updated_at desc limit 1;
 return jsonb_build_object('has_device',d.id is not null,'status',coalesce(d.status,'none'),
  'device_id',d.device_id,'device_id_short',case when d.device_id is null then null else right(d.device_id,8) end,
  'model',null,'manufacturer',null,'os_version',null,'app_version',null,'last_seen_at',null,'block_reason',null,
  'can_reset',can_reset_value,'can_release',can_release_value,'can_activate',can_activate_value);
end; $$;
revoke all on function public.app_employee_mobile_device_status(uuid) from public,anon;
grant execute on function public.app_employee_mobile_device_status(uuid) to authenticated;

create function public.app_activate_employee_mobile_device(p_employee_id uuid,p_device_id text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.approve'); actor uuid:=auth.uid(); d public.mobile_devices;
 q public.ios_web_device_requests; existing public.ios_web_devices; web_device_id uuid;
begin
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=c and e.deleted_at is null) then
  raise exception 'employee is outside company' using errcode='42501';
 end if;
 select * into d from public.mobile_devices where company_id=c and employee_id=p_employee_id
  and device_id=p_device_id and status='released' order by updated_at desc limit 1 for update;
 if not found then raise exception 'device activation request not found or no longer eligible' using errcode='P0002'; end if;
 if exists(select 1 from public.mobile_devices where company_id=c and device_id=p_device_id and status='active') then
  raise exception 'device is already active' using errcode='23505';
 end if;
 update public.mobile_devices set status='active',updated_at=clock_timestamp() where id=d.id and company_id=c;
 -- iOS browser attendance also requires the pending public-key binding. Keep
 -- that key-based check intact while letting the admin use one activation.
 if left(p_device_id,4)='ios:' then
  select * into q from public.ios_web_device_requests where company_id=c and employee_id=p_employee_id
   and device_id=p_device_id and status='pending' order by requested_at desc limit 1 for update;
  if not found then
   select * into existing from public.ios_web_devices as web where web.company_id=c
    and web.employee_id=p_employee_id and web.device_id=p_device_id and web.status='active'
    order by web.updated_at desc limit 1 for update;
   if not found then raise exception 'matching secure browser request is required' using errcode='P0002'; end if;
   web_device_id:=existing.id;
  else
  if exists(select 1 from public.ios_web_devices web where web.company_id=c and web.browser_id=q.browser_id
   and web.status='active' and web.employee_id<>p_employee_id) then
   raise exception 'browser is already bound to another employee' using errcode='23505';
  end if;
  select * into existing from public.ios_web_devices web where web.company_id=c and web.browser_id=q.browser_id
   and web.employee_id=p_employee_id and web.status in ('active','revoked','released')
   order by web.updated_at desc limit 1 for update;
  if existing.id is null then
   insert into public.ios_web_devices(company_id,employee_id,browser_id,device_id,public_key_spki,status,approved_by)
    values(c,p_employee_id,q.browser_id,q.device_id,q.public_key_spki,'active',actor) returning id into web_device_id;
  else
   update public.ios_web_devices set public_key_spki=q.public_key_spki,status='active',approved_by=actor,updated_at=clock_timestamp()
    where id=existing.id and company_id=c returning id into web_device_id;
  end if;
  update public.ios_web_device_requests set status='approved',reviewed_at=clock_timestamp() where id=q.id and company_id=c;
  end if;
  perform app_private.audit_company_action(c,'device.ios_browser_activated',
   'ios_web_device',web_device_id,null,jsonb_build_object('employee_id',p_employee_id,'browser_id_suffix',right(q.browser_id,8)));
 end if;
 perform app_private.audit_company_action(c,'device.mobile_activated','mobile_device',d.id,
  jsonb_build_object('status','released'),jsonb_build_object('status','active','employee_id',p_employee_id,
   'device_id_suffix',right(p_device_id,8),'actor_user_id',actor));
end; $$;
revoke all on function public.app_activate_employee_mobile_device(uuid,text) from public,anon;
grant execute on function public.app_activate_employee_mobile_device(uuid,text) to authenticated;

create or replace function public.app_approve_employee_ios_web(p_employee_id uuid,p_request_id uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.approve'); request_device_id text;
begin
 select request.device_id into request_device_id from public.ios_web_device_requests as request
  where request.id=p_request_id and request.company_id=c and request.employee_id=p_employee_id and request.status='pending';
 if request_device_id is null then raise exception 'pending secure browser request not found' using errcode='P0002'; end if;
 perform public.app_activate_employee_mobile_device(p_employee_id,request_device_id);
end; $$;
revoke all on function public.app_approve_employee_ios_web(uuid,uuid) from public,anon;
grant execute on function public.app_approve_employee_ios_web(uuid,uuid) to authenticated;

create or replace function app_private.enforce_attendance_device_authorization()
returns trigger language plpgsql security definer set search_path=''
as $$
declare checkin_allowed boolean:=true; checkout_allowed boolean:=true; validate_checkin boolean:=true; validate_checkout boolean:=false;
begin
 if new.source in ('admin','import','system') then return new; end if;
 if tg_op='UPDATE' then
  validate_checkin:=new.check_in_device_id is distinct from old.check_in_device_id;
  validate_checkout:=new.check_out_device_id is not null and new.check_out_device_id is distinct from old.check_out_device_id;
 else
  validate_checkout:=new.check_out_device_id is not null;
 end if;

 if validate_checkin then
  if new.check_in_device_id is null then checkin_allowed:=false;
  elsif new.check_in_device_id='web_exception' then
   select exists(select 1 from public.web_attendance_exceptions as web_exception
    where web_exception.company_id=new.company_id and web_exception.employee_id=new.employee_id and web_exception.enabled)
    into checkin_allowed;
  elsif new.check_in_device_id like 'ios:%' then
   select exists(select 1 from public.ios_web_devices as ios_device where ios_device.company_id=new.company_id
    and ios_device.employee_id=new.employee_id and ios_device.device_id=new.check_in_device_id and ios_device.status='active')
    and exists(select 1 from public.mobile_devices as mobile_device where mobile_device.company_id=new.company_id
    and mobile_device.employee_id=new.employee_id and mobile_device.device_id=new.check_in_device_id and mobile_device.status='active')
    into checkin_allowed;
  else
   select exists(select 1 from public.mobile_devices as mobile_device where mobile_device.company_id=new.company_id
    and mobile_device.employee_id=new.employee_id and mobile_device.device_id=new.check_in_device_id and mobile_device.status='active')
    into checkin_allowed;
  end if;
  if not checkin_allowed then raise exception 'attendance device is not active for this employee' using errcode='42501'; end if;
 end if;

 if validate_checkout then
  if new.check_out_device_id='web_exception' then
   select exists(select 1 from public.web_attendance_exceptions as web_exception
    where web_exception.company_id=new.company_id and web_exception.employee_id=new.employee_id and web_exception.enabled)
    into checkout_allowed;
  elsif new.check_out_device_id like 'ios:%' then
   select exists(select 1 from public.ios_web_devices as ios_device where ios_device.company_id=new.company_id
    and ios_device.employee_id=new.employee_id and ios_device.device_id=new.check_out_device_id and ios_device.status='active')
    and exists(select 1 from public.mobile_devices as mobile_device where mobile_device.company_id=new.company_id
    and mobile_device.employee_id=new.employee_id and mobile_device.device_id=new.check_out_device_id and mobile_device.status='active')
    into checkout_allowed;
  else
   select exists(select 1 from public.mobile_devices as mobile_device where mobile_device.company_id=new.company_id
    and mobile_device.employee_id=new.employee_id and mobile_device.device_id=new.check_out_device_id and mobile_device.status='active')
    into checkout_allowed;
  end if;
  if not checkout_allowed then raise exception 'attendance device is not active for this employee' using errcode='42501'; end if;
 end if;
 return new;
end; $$;
revoke all on function app_private.enforce_attendance_device_authorization() from public,anon,authenticated;
drop trigger if exists attendance_device_authorization_guard on public.attendance_sessions;
create trigger attendance_device_authorization_guard before insert or update of check_in_device_id,check_out_device_id
 on public.attendance_sessions for each row execute function app_private.enforce_attendance_device_authorization();

-- Company administrators are allowed to activate employee devices within
-- their company; this does not grant platform authority.
insert into public.role_permissions(role_id,permission_id,scope_level)
select roles.id,permissions.id,'company'
from public.roles as roles
join public.permissions as permissions on permissions.code='devices.approve'
where roles.code='COMPANY_MODERATOR' and roles.is_system
on conflict do nothing;
insert into public.role_permissions(role_id,permission_id,scope_level)
select roles.id,permissions.id,'company'
from public.roles as roles
join public.permissions as permissions on permissions.code='leaves.manage_types'
where roles.code='COMPANY_MODERATOR' and roles.is_system
on conflict do nothing;

create or replace function app_private.seed_company_moderator_permissions()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.code='COMPANY_MODERATOR' and new.is_system then
  insert into public.role_permissions(role_id,permission_id,scope_level)
  select new.id,permissions.id,'company' from public.permissions as permissions
  where permissions.code in ('devices.approve','leaves.manage_types')
  on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function app_private.seed_company_moderator_permissions() from public,anon,authenticated;
drop trigger if exists company_moderator_default_permissions on public.roles;
create trigger company_moderator_default_permissions after insert on public.roles
for each row execute function app_private.seed_company_moderator_permissions();

-- The migration runner will make the named RPCs visible through Supabase Data API.
notify pgrst, 'reload schema';
