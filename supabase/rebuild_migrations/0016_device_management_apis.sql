-- Device management and iOS browser-key registration.
-- Platform identity cannot approve/reset company devices without a company
-- membership; all operations here use explicit company permissions.
create table if not exists public.ios_web_signature_nonces (
 company_id uuid not null references public.companies(id) on delete cascade,
 browser_id text not null, nonce uuid not null, used_at timestamptz not null default clock_timestamp(),
 primary key(company_id,browser_id,nonce)
);
-- This table is created after migration 0005's RLS/grant sweep. It is only
-- accessed by the SECURITY DEFINER nonce RPC; no client or service-role table
-- grant is required.
alter table public.ios_web_signature_nonces enable row level security;
revoke all on table public.ios_web_signature_nonces from public,anon,authenticated,service_role;

create function public.app_employee_mobile_device_status(p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.view'); d public.mobile_devices; can_reset_value boolean:=public.has_permission('devices.reset'); can_release_value boolean:=public.has_permission('devices.release');
begin
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=c) then raise exception 'employee is outside company' using errcode='42501'; end if;
 select * into d from public.mobile_devices where company_id=c and employee_id=p_employee_id order by updated_at desc limit 1;
 return jsonb_build_object('has_device',d.id is not null,'status',case when d.id is null then 'none' when d.status='active' then 'active' when d.status='released' then 'released' else 'blocked' end,
  'device_id',d.device_id,'device_id_short',case when d.device_id is null then null else right(d.device_id,8) end,'model',null,'manufacturer',null,'os_version',null,'app_version',null,'last_seen_at',null,'block_reason',null,'can_reset',can_reset_value,'can_release',can_release_value);
end; $$;
revoke all on function public.app_employee_mobile_device_status(uuid) from public,anon;
grant execute on function public.app_employee_mobile_device_status(uuid) to authenticated;

create function public.app_employee_ios_web_status(p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.view'); d public.ios_web_devices; q public.ios_web_device_requests;
begin
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=c) then raise exception 'employee is outside company' using errcode='42501'; end if;
 select * into d from public.ios_web_devices where company_id=c and employee_id=p_employee_id and status in ('active','revoked') order by updated_at desc limit 1;
 select * into q from public.ios_web_device_requests where company_id=c and employee_id=p_employee_id and status='pending' order by requested_at desc limit 1;
 return jsonb_build_object('has_device',d.id is not null,'status',case when d.id is null then 'none' when d.status='active' then 'active' else 'blocked' end,
  'browser_id_short',case when d.browser_id is null then null else right(d.browser_id,8) end,'pending',q.id is not null,'request_id',q.id,'request_code',q.request_code,'requested_at',q.requested_at,'can_manage',public.has_permission('devices.approve') or public.has_permission('devices.reset'));
end; $$;
revoke all on function public.app_employee_ios_web_status(uuid) from public,anon;
grant execute on function public.app_employee_ios_web_status(uuid) to authenticated;

create function public.app_employee_web_attendance_exception_status(p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.view'); w public.web_attendance_exceptions;
begin
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=c) then raise exception 'employee is outside company' using errcode='42501'; end if;
 select * into w from public.web_attendance_exceptions where company_id=c and employee_id=p_employee_id;
 return jsonb_build_object('enabled',coalesce(w.enabled,false),'reason',w.reason,'can_manage',public.has_permission('devices.manage'));
end; $$;
revoke all on function public.app_employee_web_attendance_exception_status(uuid) from public,anon;
grant execute on function public.app_employee_web_attendance_exception_status(uuid) to authenticated;

create function public.app_set_employee_web_attendance_exception(p_employee_id uuid,p_enabled boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.manage'); old_row public.web_attendance_exceptions; actor uuid:=auth.uid();
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'reason is required' using errcode='22023'; end if;
 if not exists(select 1 from public.employees where id=p_employee_id and company_id=c and deleted_at is null) then raise exception 'employee is outside company' using errcode='42501'; end if;
 select * into old_row from public.web_attendance_exceptions where company_id=c and employee_id=p_employee_id for update;
 insert into public.web_attendance_exceptions(company_id,employee_id,enabled,reason,set_by,updated_at)
 values(c,p_employee_id,coalesce(p_enabled,false),btrim(p_reason),actor,clock_timestamp()) on conflict(employee_id) do update set enabled=excluded.enabled,reason=excluded.reason,set_by=excluded.set_by,updated_at=clock_timestamp();
 perform app_private.audit_company_action(c,'device.web_attendance_exception_changed','employee',p_employee_id,case when old_row.id is null then null else to_jsonb(old_row) end,jsonb_build_object('enabled',coalesce(p_enabled,false),'reason',btrim(p_reason)));
 return jsonb_build_object('ok',true,'message',case when p_enabled then 'تم السماح بالحضور الآمن من المتصفح.' else 'تم إلغاء استثناء الحضور من المتصفح.' end);
end; $$;
revoke all on function public.app_set_employee_web_attendance_exception(uuid,boolean,text) from public,anon;
grant execute on function public.app_set_employee_web_attendance_exception(uuid,boolean,text) to authenticated;

create function public.app_approve_employee_ios_web(p_employee_id uuid,p_request_id uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.approve'); actor uuid:=auth.uid(); q public.ios_web_device_requests; existing public.ios_web_devices; device_record uuid;
begin
 select * into q from public.ios_web_device_requests where id=p_request_id and company_id=c and employee_id=p_employee_id and status='pending' for update;
 if not found then raise exception 'pending device request not found' using errcode='P0002'; end if;
 if exists(select 1 from public.ios_web_devices d where d.company_id=c and d.browser_id=q.browser_id and d.status='active' and d.employee_id<>p_employee_id) then raise exception 'browser is already bound to another employee' using errcode='23505'; end if;
 select * into existing from public.ios_web_devices where company_id=c and browser_id=q.browser_id and employee_id=p_employee_id and status in ('active','revoked','released') order by updated_at desc limit 1 for update;
 if existing.id is null then
  insert into public.ios_web_devices(company_id,employee_id,browser_id,device_id,public_key_spki,status,approved_by)
  values(c,p_employee_id,q.browser_id,q.device_id,q.public_key_spki,'active',actor) returning id into device_record;
 else
  update public.ios_web_devices set public_key_spki=q.public_key_spki,status='active',approved_by=actor,updated_at=clock_timestamp() where id=existing.id and company_id=c returning id into device_record;
 end if;
 update public.ios_web_device_requests set status='approved',reviewed_at=clock_timestamp() where id=q.id and company_id=c;
 perform app_private.audit_company_action(c,'device.ios_browser_approved','ios_web_device',device_record,null,jsonb_build_object('employee_id',p_employee_id,'browser_id_suffix',right(q.browser_id,8)));
end; $$;
revoke all on function public.app_approve_employee_ios_web(uuid,uuid) from public,anon;
grant execute on function public.app_approve_employee_ios_web(uuid,uuid) to authenticated;

create function public.app_reset_employee_ios_web(p_employee_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.reset'); n integer;
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'reason is required' using errcode='22023'; end if;
 if not exists(select 1 from public.employees where id=p_employee_id and company_id=c) then raise exception 'employee is outside company' using errcode='42501'; end if;
 update public.ios_web_devices set status='revoked',updated_at=clock_timestamp() where company_id=c and employee_id=p_employee_id and status='active'; get diagnostics n=row_count;
 update public.ios_web_device_requests set status='cancelled',reviewed_at=clock_timestamp() where company_id=c and employee_id=p_employee_id and status='pending';
 perform app_private.audit_company_action(c,'device.ios_browser_reset','employee',p_employee_id,null,jsonb_build_object('revoked_count',n,'reason',btrim(p_reason)));
end; $$;
revoke all on function public.app_reset_employee_ios_web(uuid,text) from public,anon;
grant execute on function public.app_reset_employee_ios_web(uuid,text) to authenticated;

create function public.app_reset_employee_mobile_device(p_employee_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.reset'); actor uuid:=public.current_employee_id(); n integer;
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'reason is required' using errcode='22023'; end if;
 if not exists(select 1 from public.employees where id=p_employee_id and company_id=c) then raise exception 'employee is outside company' using errcode='42501'; end if;
 update public.mobile_devices set status='revoked',updated_at=clock_timestamp() where company_id=c and employee_id=p_employee_id and status='active'; get diagnostics n=row_count;
 perform app_private.audit_company_action(c,'device.mobile_reset','employee',p_employee_id,null,jsonb_build_object('revoked_count',n,'reason',btrim(p_reason),'actor_employee_id',actor));
end; $$;
revoke all on function public.app_reset_employee_mobile_device(uuid,text) from public,anon;
grant execute on function public.app_reset_employee_mobile_device(uuid,text) to authenticated;

create function public.app_release_mobile_device(p_device_id text,p_reason text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('devices.release'); d public.mobile_devices;
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'reason is required' using errcode='22023'; end if;
 select * into d from public.mobile_devices where company_id=c and device_id=p_device_id and status='revoked' order by updated_at desc limit 1 for update;
 if not found then raise exception 'revoked device not found' using errcode='P0002'; end if;
 update public.mobile_devices set status='released',updated_at=clock_timestamp() where id=d.id and company_id=c;
 perform app_private.audit_company_action(c,'device.mobile_released','mobile_device',d.id,to_jsonb(d),jsonb_build_object('status','released','reason',btrim(p_reason)));
end; $$;
revoke all on function public.app_release_mobile_device(text,text) from public,anon;
grant execute on function public.app_release_mobile_device(text,text) to authenticated;

create function public.app_my_ios_web_device_status(p_browser_id text,p_public_key_spki text) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); d public.ios_web_devices; q public.ios_web_device_requests;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select * into d from public.ios_web_devices where company_id=c and employee_id=e and browser_id=p_browser_id and status='active';
 select * into q from public.ios_web_device_requests where company_id=c and employee_id=e and browser_id=p_browser_id and status='pending' order by requested_at desc limit 1;
 return jsonb_build_object('bound',d.id is not null and d.public_key_spki=p_public_key_spki,'pending',q.id is not null,'request_id',q.id,'request_code',q.request_code,
  'deviceCode',case when d.id is null then null else right(d.browser_id,8) end,'code',case when d.id is not null and d.public_key_spki<>p_public_key_spki then 'KEY_CHANGED' else null end,
  'message',case when d.id is not null and d.public_key_spki<>p_public_key_spki then 'مفتاح هذا المتصفح تغير. أعد طلب التفعيل من المسؤول.' else null end);
end; $$;
revoke all on function public.app_my_ios_web_device_status(text,text) from public,anon;
grant execute on function public.app_my_ios_web_device_status(text,text) to authenticated;

create function public.app_request_ios_web_binding(p_browser_id text,p_public_key_spki text,p_user_agent text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); d public.ios_web_devices; q public.ios_web_device_requests; request_id uuid; code_value text;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 if nullif(p_browser_id,'') is null or length(p_browser_id)>100 or nullif(p_public_key_spki,'') is null or length(p_public_key_spki)>2048 then raise exception 'invalid browser key registration' using errcode='22023'; end if;
 if exists(select 1 from public.ios_web_devices where company_id=c and browser_id=p_browser_id and employee_id<>e and status='active') then raise exception 'browser is already registered to another employee' using errcode='23505'; end if;
 select * into d from public.ios_web_devices where company_id=c and employee_id=e and browser_id=p_browser_id and status='active';
 if d.id is not null then return jsonb_build_object('bound',d.public_key_spki=p_public_key_spki,'pending',false,'code',case when d.public_key_spki<>p_public_key_spki then 'KEY_CHANGED' else null end); end if;
 select * into q from public.ios_web_device_requests where company_id=c and employee_id=e and browser_id=p_browser_id and status='pending' order by requested_at desc limit 1;
 if q.id is not null then
  if q.public_key_spki<>p_public_key_spki then update public.ios_web_device_requests set status='cancelled',reviewed_at=clock_timestamp() where id=q.id and company_id=c; else return jsonb_build_object('bound',false,'pending',true,'requestCode',q.request_code); end if;
 end if;
 code_value:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.ios_web_device_requests(company_id,employee_id,browser_id,device_id,public_key_spki,request_code,user_agent)
 values(c,e,p_browser_id,'ios:'||p_browser_id,p_public_key_spki,code_value,left(coalesce(p_user_agent,''),250)) returning id into request_id;
 perform app_private.audit_company_action(c,'device.ios_browser_requested','ios_web_device_request',request_id,null,jsonb_build_object('browser_id_suffix',right(p_browser_id,8)));
 return jsonb_build_object('bound',false,'pending',true,'requestId',request_id,'requestCode',code_value);
end; $$;
revoke all on function public.app_request_ios_web_binding(text,text,text) from public,anon;
grant execute on function public.app_request_ios_web_binding(text,text,text) to authenticated;

create function public.app_my_ios_web_device_public_key(p_browser_id text) returns text
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); key_value text;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select public_key_spki into key_value from public.ios_web_devices where company_id=c and employee_id=e and browser_id=p_browser_id and status='active';
 if key_value is null then raise exception 'active browser device required' using errcode='42501'; end if;
 return key_value;
end; $$;
revoke all on function public.app_my_ios_web_device_public_key(text) from public,anon;
grant execute on function public.app_my_ios_web_device_public_key(text) to authenticated;

create function public.app_consume_ios_web_nonce(p_browser_id text,p_nonce uuid,p_timestamp timestamptz) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id();
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 if p_nonce is null or p_timestamp is null or abs(extract(epoch from (clock_timestamp()-p_timestamp)))>120 then raise exception 'signed request expired' using errcode='42501'; end if;
 if not exists(select 1 from public.ios_web_devices where company_id=c and employee_id=e and browser_id=p_browser_id and status='active') then raise exception 'active browser device required' using errcode='42501'; end if;
 delete from public.ios_web_signature_nonces where company_id=c and used_at<clock_timestamp()-interval '7 days';
 insert into public.ios_web_signature_nonces(company_id,browser_id,nonce) values(c,p_browser_id,p_nonce);
exception when unique_violation then raise exception 'signed request has already been used' using errcode='42501';
end; $$;
revoke all on function public.app_consume_ios_web_nonce(text,uuid,timestamptz) from public,anon;
grant execute on function public.app_consume_ios_web_nonce(text,uuid,timestamptz) to authenticated;
