-- Employee leave and hour-permission workflows. Review routing is two-stage:
-- assigned branch manager, then assigned area manager for the branch's region.
-- Hour requests retain the existing UI's 240-minute monthly cap.

create function public.app_submit_leave_request(p_leave_type_id uuid,p_starts_on date,p_ends_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); leave_type public.leave_types; request_id uuid; days_value numeric; branch_value uuid; region_value uuid;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select emp.branch_id,b.region_id into branch_value,region_value from public.employees emp left join public.branches b on b.id=emp.branch_id and b.company_id=c where emp.id=e and emp.company_id=c;
 if branch_value is null or region_value is null then raise exception 'leave approval requires an assigned branch and region' using errcode='23514'; end if;
 if p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on then raise exception 'invalid leave dates' using errcode='22023'; end if;
 select leave_types.* into leave_type from public.leave_types as leave_types where leave_types.id=p_leave_type_id and leave_types.company_id=c and leave_types.is_active;
 if not found then raise exception 'leave type is unavailable' using errcode='22023'; end if;
 if leave_type.requires_attachment then raise exception 'this leave type requires an attachment, but the portal does not yet support attachment uploads' using errcode='0A000'; end if;
 perform 1 from public.employees where id=e and company_id=c for update;
 days_value:=(p_ends_on-p_starts_on)+1;
 if exists(select 1 from public.leave_requests lr where lr.company_id=c and lr.employee_id=e and lr.status in ('pending','approved') and daterange(lr.starts_on,lr.ends_on,'[]') && daterange(p_starts_on,p_ends_on,'[]')) then
  raise exception 'leave dates overlap an existing request' using errcode='23505'; end if;
 insert into public.leave_requests(company_id,employee_id,leave_type_id,starts_on,ends_on,requested_days,reason)
 values(c,e,p_leave_type_id,p_starts_on,p_ends_on,days_value,nullif(btrim(p_reason),'')) returning id into request_id;
 insert into public.request_approval_workflows(company_id,request_type,request_id,employee_id,branch_id,region_id,current_stage,current_stage_order,status)
 values(c,'leave',request_id,e,branch_value,region_value,'branch',1,'pending') on conflict(request_type,request_id) do nothing;
 insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
 select c,m.employee_id,m.user_id,'leave.requested','طلب إجازة جديد',format('طلب إجازة من %s إلى %s',p_starts_on,p_ends_on),'leave_request',request_id
 from public.company_memberships m join public.employees approver on approver.id=m.employee_id and approver.company_id=c
 where m.company_id=c and m.status='active' and approver.id<>e and exists(
  select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=c and r.code='BRANCH_MANAGER' and r.is_active
  join public.role_permissions rp on rp.role_id=r.id and rp.scope_level='branch'
  join public.permissions p on p.id=rp.permission_id and p.code='leaves.approve'
  where er.employee_id=approver.id and exists(select 1 from public.employee_scope_assignments a where a.employee_id=approver.id and a.role_id=r.id and a.company_id=c and a.scope_level='branch' and a.scope_id=branch_value))
 on conflict do nothing;
 perform app_private.audit_company_action(c,'leave.requested','leave_request',request_id,null,jsonb_build_object('leave_type_id',p_leave_type_id,'starts_on',p_starts_on,'ends_on',p_ends_on,'requested_days',days_value));
 return jsonb_build_object('ok',true,'request_id',request_id,'status','pending');
end; $$;
revoke all on function public.app_submit_leave_request(uuid,date,date,text) from public,anon;
grant execute on function public.app_submit_leave_request(uuid,date,date,text) to authenticated;

create function public.app_cancel_leave_request(p_request_id uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); r public.leave_requests;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select leave_request.* into r from public.leave_requests as leave_request where leave_request.id=p_request_id and leave_request.company_id=c and leave_request.employee_id=e and leave_request.status='pending' for update;
 if not found then raise exception 'pending leave request not found' using errcode='P0002'; end if;
 update public.leave_requests as leave_request set status='cancelled',updated_at=clock_timestamp() where leave_request.id=r.id and leave_request.company_id=c;
 update public.request_approval_workflows as approval_workflow set status='cancelled',current_stage='completed',final_status='cancelled',updated_at=clock_timestamp(),completed_at=clock_timestamp() where approval_workflow.company_id=c and approval_workflow.request_type='leave' and approval_workflow.request_id=r.id and approval_workflow.status='pending';
 perform app_private.audit_company_action(c,'leave.cancelled','leave_request',r.id,to_jsonb(r),jsonb_build_object('status','cancelled'));
end; $$;
revoke all on function public.app_cancel_leave_request(uuid) from public,anon;
grant execute on function public.app_cancel_leave_request(uuid) to authenticated;

create function public.app_list_leave_requests(p_status text default null)
returns table(id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,leave_type_name text,
 starts_on date,ends_on date,requested_days numeric,reason text,status text,reviewer_name text,reviewer_notes text,created_at timestamptz,
 approval_stage text,can_review boolean,branch_reviewer_name text,region_reviewer_name text)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); can_view_all boolean:=public.has_permission('leaves.approve');
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 return query select lr.id as id,emp.id as employee_id,emp.employee_code as employee_code,emp.full_name as employee_name,b.name as branch_name,lt.name as leave_type_name,lr.starts_on as starts_on,lr.ends_on as ends_on,lr.requested_days as requested_days,lr.reason as reason,lr.status as status,reviewer.full_name as reviewer_name,lr.reviewer_notes as reviewer_notes,lr.created_at as created_at,
  coalesce(w.current_stage,'completed'),lr.status='pending' and (
   (w.current_stage='branch' and public.has_permission('leaves.approve',w.branch_id,w.region_id,'BRANCH_MANAGER'))
   or (w.current_stage='region' and public.has_permission('leaves.approve',w.branch_id,w.region_id,'AREA_MANAGER'))
  ),branch_reviewer.full_name,region_reviewer.full_name
 from public.leave_requests lr join public.employees emp on emp.id=lr.employee_id and emp.company_id=c
 join public.leave_types lt on lt.id=lr.leave_type_id and lt.company_id=c
 left join public.request_approval_workflows w on w.company_id=c and w.request_type='leave' and w.request_id=lr.id
 left join public.branches b on b.id=emp.branch_id and b.company_id=c
 left join public.employees reviewer on reviewer.id=lr.reviewed_by and reviewer.company_id=c
 left join public.employees branch_reviewer on branch_reviewer.id=w.branch_reviewed_by and branch_reviewer.company_id=c
 left join public.employees region_reviewer on region_reviewer.id=w.region_reviewed_by and region_reviewer.company_id=c
 where lr.company_id=c and (can_view_all or lr.employee_id=e or lr.status='pending' and (
  (w.current_stage='branch' and public.has_permission('leaves.approve',w.branch_id,w.region_id,'BRANCH_MANAGER'))
  or (w.current_stage='region' and public.has_permission('leaves.approve',w.branch_id,w.region_id,'AREA_MANAGER'))
 )) and (p_status is null or lr.status=p_status)
 order by lr.created_at desc;
end; $$;
revoke all on function public.app_list_leave_requests(text) from public,anon;
grant execute on function public.app_list_leave_requests(text) to authenticated;

create function public.app_list_leave_requests_v2(p_status text default null)
returns table(id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,leave_type_name text,
 starts_on date,ends_on date,requested_days numeric,reason text,status text,reviewer_name text,reviewer_notes text,created_at timestamptz,
 approval_stage text,can_review boolean,branch_reviewer_name text,region_reviewer_name text)
language sql stable security definer set search_path=''
as $$ select * from public.app_list_leave_requests(p_status) $$;
revoke all on function public.app_list_leave_requests_v2(text) from public,anon;
grant execute on function public.app_list_leave_requests_v2(text) to authenticated;

create function public.app_review_leave_request(p_request_id uuid,p_decision text,p_notes text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); reviewer_id uuid:=public.current_employee_id(); r public.leave_requests; w public.request_approval_workflows; stage_role text; next_stage text;
begin
 if auth.uid() is null or c is null or reviewer_id is null then raise exception 'active company employee required' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
 select leave_request.* into r from public.leave_requests as leave_request where leave_request.id=p_request_id and leave_request.company_id=c and leave_request.status='pending' for update;
 if not found then raise exception 'pending leave request not found' using errcode='P0002'; end if;
 if reviewer_id=r.employee_id then raise exception 'cannot review your own leave request' using errcode='42501'; end if;
 select * into w from public.request_approval_workflows where company_id=c and request_type='leave' and request_id=r.id for update;
 if not found or w.branch_id is null or w.region_id is null then raise exception 'leave approval route is incomplete' using errcode='23514'; end if;
 stage_role:=case when w.current_stage='branch' then 'BRANCH_MANAGER' when w.current_stage='region' then 'AREA_MANAGER' else null end;
 if w.current_stage='region' and w.branch_reviewed_by=reviewer_id then raise exception 'the branch reviewer cannot perform the final region review' using errcode='42501'; end if;
 if stage_role is null or not public.has_permission('leaves.approve',w.branch_id,w.region_id,stage_role) then raise exception 'reviewer is not assigned to the current approval scope' using errcode='42501'; end if;
 if w.current_stage='branch' then
  update public.request_approval_workflows as approval_workflow set branch_decision=p_decision,branch_reviewed_at=clock_timestamp(),branch_note=nullif(btrim(p_notes),''),branch_reviewed_by=reviewer_id,
   current_stage=case when p_decision='approved' then 'region' else 'completed' end,current_stage_order=case when p_decision='approved' then 2 else current_stage_order end,
   status=case when p_decision='approved' then 'pending' else 'rejected' end,final_status=case when p_decision='rejected' then 'rejected' else null end,
   completed_at=case when p_decision='rejected' then clock_timestamp() else null end,updated_at=clock_timestamp()
  where approval_workflow.id=w.id and approval_workflow.company_id=c;
  if p_decision='rejected' then
   update public.leave_requests as leave_request set status='rejected',reviewed_by=reviewer_id,reviewer_notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp() where leave_request.id=r.id and leave_request.company_id=c;
  else
   next_stage:='region';
  end if;
 else
  update public.request_approval_workflows as approval_workflow set region_decision=p_decision,region_reviewed_at=clock_timestamp(),region_note=nullif(btrim(p_notes),''),region_reviewed_by=reviewer_id,
   current_stage='completed',current_stage_order=2,status=p_decision,final_status=p_decision,completed_at=clock_timestamp(),updated_at=clock_timestamp()
  where approval_workflow.id=w.id and approval_workflow.company_id=c;
  update public.leave_requests as leave_request set status=p_decision,reviewed_by=reviewer_id,reviewer_notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp() where leave_request.id=r.id and leave_request.company_id=c;
 end if;
 if next_stage='region' then
  insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
  select c,m.employee_id,m.user_id,'leave.awaiting_region_review','طلب إجازة بانتظار اعتماد المنطقة','تم اعتماد الطلب في الفرع ويحتاج إلى المراجعة النهائية.','leave_request',r.id
  from public.company_memberships m join public.employee_roles er on er.employee_id=m.employee_id
  join public.roles ro on ro.id=er.role_id and ro.company_id=c and ro.code='AREA_MANAGER' and ro.is_active
  where m.company_id=c and m.status='active' and exists(select 1 from public.employee_scope_assignments a where a.employee_id=m.employee_id and a.role_id=ro.id and a.company_id=c and a.scope_level='region' and a.scope_id=w.region_id);
 end if;
 if next_stage is null then
  insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
  select c,r.employee_id,m.user_id,'leave.'||p_decision,'تحديث طلب الإجازة',case when p_decision='approved' then 'تم اعتماد طلب الإجازة.' else 'تم رفض طلب الإجازة.' end,'leave_request',r.id
  from public.company_memberships m where m.company_id=c and m.employee_id=r.employee_id and m.status='active';
 end if;
 perform app_private.audit_company_action(c,'leave.'||w.current_stage||'.'||p_decision,'leave_request',r.id,to_jsonb(r),jsonb_build_object('status',p_decision,'notes',p_notes,'workflow_id',w.id));
 return jsonb_build_object('ok',true,'stage',coalesce(next_stage,'completed'),'message',case when next_stage='region' then 'تم اعتماد الطلب في الفرع وإرساله للاعتماد النهائي.' when p_decision='approved' then 'تم اعتماد طلب الإجازة.' else 'تم رفض طلب الإجازة.' end);
end; $$;
revoke all on function public.app_review_leave_request(uuid,text,text) from public,anon;
grant execute on function public.app_review_leave_request(uuid,text,text) to authenticated;
create function public.app_review_leave_request_v2(p_request_id uuid,p_decision text,p_notes text) returns jsonb
language sql security definer set search_path='' as $$ select public.app_review_leave_request(p_request_id,p_decision,p_notes) $$;
revoke all on function public.app_review_leave_request_v2(uuid,text,text) from public,anon;
grant execute on function public.app_review_leave_request_v2(uuid,text,text) to authenticated;

create function public.app_request_hour_permission(p_permission_date date,p_permission_type text,p_requested_minutes integer,p_reason text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); request_id uuid; used_minutes integer; tz text; today_value date; branch_value uuid; region_value uuid;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select emp.branch_id,b.region_id into branch_value,region_value from public.employees emp left join public.branches b on b.id=emp.branch_id and b.company_id=c where emp.id=e and emp.company_id=c;
 if branch_value is null or region_value is null then raise exception 'hour permission approval requires an assigned branch and region' using errcode='23514'; end if;
 if p_permission_date is null or p_permission_type not in ('late_arrival','early_leave') or p_requested_minutes not in (60,120,240) then raise exception 'invalid hour permission request' using errcode='22023'; end if;
 select coalesce(companies.timezone,'Africa/Cairo') into tz
  from public.companies as companies where companies.id=c;
 today_value:=(clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date;
 if date_trunc('month',p_permission_date)::date<>date_trunc('month',today_value)::date then raise exception 'hour permission date must be in the current month' using errcode='22023'; end if;
 if not exists(select 1 from public.shift_assignments sa where sa.company_id=c and sa.employee_id=e and sa.shift_date=p_permission_date and sa.status='published' and sa.day_type='work') then
  raise exception 'a published work shift is required for this date' using errcode='P0001'; end if;
 perform 1 from public.employees where id=e and company_id=c for update;
 select coalesce(sum(requested_minutes),0)::integer into used_minutes from public.employee_hour_permissions where company_id=c and employee_id=e and date_trunc('month',permission_date)=date_trunc('month',p_permission_date) and status in ('approved','pending');
 if used_minutes+p_requested_minutes>240 then raise exception 'monthly hour permission limit exceeded' using errcode='22023'; end if;
 insert into public.employee_hour_permissions(company_id,employee_id,permission_date,permission_type,requested_minutes,reason)
 values(c,e,p_permission_date,p_permission_type,p_requested_minutes,nullif(btrim(p_reason),'')) returning id into request_id;
 insert into public.request_approval_workflows(company_id,request_type,request_id,employee_id,branch_id,region_id,current_stage,current_stage_order,status)
 values(c,'hour_permission',request_id,e,branch_value,region_value,'branch',1,'pending') on conflict(request_type,request_id) do nothing;
 insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
 select c,m.employee_id,m.user_id,'hour_permission.requested','طلب إذن ساعات جديد',format('طلب إذن بتاريخ %s.',p_permission_date),'hour_permission',request_id
 from public.company_memberships m join public.employee_roles er on er.employee_id=m.employee_id
 join public.roles r on r.id=er.role_id and r.company_id=c and r.code='BRANCH_MANAGER' and r.is_active
 join public.role_permissions rp on rp.role_id=r.id and rp.scope_level='branch'
 join public.permissions p on p.id=rp.permission_id and p.code='hour_permissions.approve'
 join public.employees approver on approver.id=m.employee_id and approver.company_id=c
 where m.company_id=c and m.status='active' and m.employee_id<>e
  and exists(select 1 from public.employee_scope_assignments a where a.employee_id=approver.id and a.role_id=r.id and a.company_id=c and a.scope_level='branch' and a.scope_id=branch_value);
 perform app_private.audit_company_action(c,'hour_permission.requested','hour_permission',request_id,null,jsonb_build_object('permission_date',p_permission_date,'type',p_permission_type,'minutes',p_requested_minutes));
 return jsonb_build_object('ok',true,'message','تم إرسال طلب الإذن للمراجعة.');
end; $$;
revoke all on function public.app_request_hour_permission(date,text,integer,text) from public,anon;
grant execute on function public.app_request_hour_permission(date,text,integer,text) to authenticated;

create function public.app_cancel_hour_permission(p_permission_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); r public.employee_hour_permissions;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select hourly_permission.* into r from public.employee_hour_permissions as hourly_permission where hourly_permission.id=p_permission_id and hourly_permission.company_id=c and hourly_permission.employee_id=e and hourly_permission.status='pending' for update;
 if not found then raise exception 'pending hour permission request not found' using errcode='P0002'; end if;
 update public.employee_hour_permissions as hourly_permission set status='cancelled',updated_at=clock_timestamp() where hourly_permission.id=r.id and hourly_permission.company_id=c;
 update public.request_approval_workflows as approval_workflow set status='cancelled',current_stage='completed',final_status='cancelled',updated_at=clock_timestamp(),completed_at=clock_timestamp() where approval_workflow.company_id=c and approval_workflow.request_type='hour_permission' and approval_workflow.request_id=r.id and approval_workflow.status='pending';
 perform app_private.audit_company_action(c,'hour_permission.cancelled','hour_permission',r.id,to_jsonb(r),jsonb_build_object('status','cancelled'));
 return jsonb_build_object('ok',true,'message','تم إلغاء طلب الإذن.');
end; $$;
revoke all on function public.app_cancel_hour_permission(uuid) from public,anon;
grant execute on function public.app_cancel_hour_permission(uuid) to authenticated;

create function public.app_my_hour_permission_balance(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); month_value date; approved_value integer; pending_value integer; tz text;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select coalesce(companies.timezone,'Africa/Cairo') into tz
  from public.companies as companies where companies.id=c;
 month_value:=coalesce(date_trunc('month',p_month)::date,date_trunc('month',clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date);
 select coalesce(sum(requested_minutes) filter(where status='approved'),0)::integer,coalesce(sum(requested_minutes) filter(where status='pending'),0)::integer into approved_value,pending_value
 from public.employee_hour_permissions where company_id=c and employee_id=e and date_trunc('month',permission_date)=month_value;
 return jsonb_build_object('ok',true,'monthly_limit_minutes',240,'monthly_limit_hours',4,'approved_minutes',approved_value,'pending_minutes',pending_value,'remaining_minutes',greatest(240-approved_value,0),'available_to_request_minutes',greatest(240-approved_value-pending_value,0),'month',month_value);
end; $$;
revoke all on function public.app_my_hour_permission_balance(date) from public,anon;
grant execute on function public.app_my_hour_permission_balance(date) to authenticated;

create function public.app_list_my_hour_permissions(p_month date default null)
returns table(id uuid,permission_date date,permission_type text,requested_minutes integer,reason text,status text,review_note text,reviewed_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); tz text; month_value date;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select coalesce(companies.timezone,'Africa/Cairo') into tz
  from public.companies as companies where companies.id=c;
 month_value:=coalesce(date_trunc('month',p_month)::date,date_trunc('month',clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date);
 return query select hourly_permissions.id as id,hourly_permissions.permission_date as permission_date,hourly_permissions.permission_type as permission_type,
  hourly_permissions.requested_minutes as requested_minutes,hourly_permissions.reason as reason,hourly_permissions.status as status,
  hourly_permissions.review_note as review_note,hourly_permissions.reviewed_at as reviewed_at,hourly_permissions.created_at as created_at
  from public.employee_hour_permissions as hourly_permissions
  where hourly_permissions.company_id=c and hourly_permissions.employee_id=e
   and date_trunc('month',hourly_permissions.permission_date)=month_value
  order by hourly_permissions.permission_date desc,hourly_permissions.created_at desc;
end; $$;
revoke all on function public.app_list_my_hour_permissions(date) from public,anon;
grant execute on function public.app_list_my_hour_permissions(date) to authenticated;

create function public.app_list_hour_permissions(p_status text default null,p_month date default null)
returns table(id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,permission_date date,permission_type text,requested_minutes integer,reason text,status text,reviewer_name text,review_note text,reviewed_at timestamptz,created_at timestamptz,approval_stage text,can_review boolean,branch_reviewer_name text,region_reviewer_name text)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); e uuid:=public.current_employee_id(); can_view_all boolean:=public.has_permission('hour_permissions.approve'); m date; tz text;
begin
 if auth.uid() is null or c is null or e is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select coalesce(companies.timezone,'Africa/Cairo') into tz
  from public.companies as companies where companies.id=c;
 m:=coalesce(date_trunc('month',p_month)::date,date_trunc('month',clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date);
 return query select hourly_permissions.id as id,emp.id as employee_id,emp.employee_code as employee_code,emp.full_name as employee_name,b.name as branch_name,hourly_permissions.permission_date as permission_date,hourly_permissions.permission_type as permission_type,hourly_permissions.requested_minutes as requested_minutes,hourly_permissions.reason as reason,hourly_permissions.status as status,reviewer.full_name as reviewer_name,hourly_permissions.review_note as review_note,hourly_permissions.reviewed_at as reviewed_at,hourly_permissions.created_at as created_at,
  coalesce(w.current_stage,'completed'),hourly_permissions.status='pending' and (
   (w.current_stage='branch' and public.has_permission('hour_permissions.approve',w.branch_id,w.region_id,'BRANCH_MANAGER'))
   or (w.current_stage='region' and public.has_permission('hour_permissions.approve',w.branch_id,w.region_id,'AREA_MANAGER'))
  ),branch_reviewer.full_name,region_reviewer.full_name
 from public.employee_hour_permissions as hourly_permissions join public.employees emp on emp.id=hourly_permissions.employee_id and emp.company_id=c
 left join public.request_approval_workflows w on w.company_id=c and w.request_type='hour_permission' and w.request_id=hourly_permissions.id
 left join public.branches b on b.id=emp.branch_id and b.company_id=c
 left join public.employees reviewer on reviewer.id=hourly_permissions.reviewed_by_employee_id and reviewer.company_id=c
 left join public.employees branch_reviewer on branch_reviewer.id=w.branch_reviewed_by and branch_reviewer.company_id=c
 left join public.employees region_reviewer on region_reviewer.id=w.region_reviewed_by and region_reviewer.company_id=c
 where hourly_permissions.company_id=c and date_trunc('month',hourly_permissions.permission_date)=m and (can_view_all or hourly_permissions.employee_id=e or hourly_permissions.status='pending' and (
  (w.current_stage='branch' and public.has_permission('hour_permissions.approve',w.branch_id,w.region_id,'BRANCH_MANAGER'))
  or (w.current_stage='region' and public.has_permission('hour_permissions.approve',w.branch_id,w.region_id,'AREA_MANAGER'))
 )) and (p_status is null or hourly_permissions.status=p_status)
 order by hourly_permissions.permission_date desc,hourly_permissions.created_at desc;
end; $$;
revoke all on function public.app_list_hour_permissions(text,date) from public,anon;
grant execute on function public.app_list_hour_permissions(text,date) to authenticated;
create function public.app_list_hour_permissions_v2(p_status text default null,p_month date default null)
returns table(id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,permission_date date,permission_type text,requested_minutes integer,reason text,status text,reviewer_name text,review_note text,reviewed_at timestamptz,created_at timestamptz,approval_stage text,can_review boolean,branch_reviewer_name text,region_reviewer_name text)
language sql stable security definer set search_path='' as $$ select * from public.app_list_hour_permissions(p_status,p_month) $$;
revoke all on function public.app_list_hour_permissions_v2(text,date) from public,anon;
grant execute on function public.app_list_hour_permissions_v2(text,date) to authenticated;

create function public.app_review_hour_permission(p_permission_id uuid,p_approve boolean,p_note text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); reviewer_id uuid:=public.current_employee_id(); r public.employee_hour_permissions; w public.request_approval_workflows; decision_value text:=case when p_approve then 'approved' else 'rejected' end; stage_role text; next_stage text;
begin
 if auth.uid() is null or c is null or reviewer_id is null then raise exception 'active company employee required' using errcode='42501'; end if;
 select hourly_permission.* into r from public.employee_hour_permissions as hourly_permission where hourly_permission.id=p_permission_id and hourly_permission.company_id=c and hourly_permission.status='pending' for update;
 if not found then raise exception 'pending hour permission request not found' using errcode='P0002'; end if;
 if reviewer_id=r.employee_id then raise exception 'cannot review your own hour permission request' using errcode='42501'; end if;
 select * into w from public.request_approval_workflows where company_id=c and request_type='hour_permission' and request_id=r.id for update;
 if not found or w.branch_id is null or w.region_id is null then raise exception 'hour permission approval route is incomplete' using errcode='23514'; end if;
 stage_role:=case when w.current_stage='branch' then 'BRANCH_MANAGER' when w.current_stage='region' then 'AREA_MANAGER' else null end;
 if w.current_stage='region' and w.branch_reviewed_by=reviewer_id then raise exception 'the branch reviewer cannot perform the final region review' using errcode='42501'; end if;
 if stage_role is null or not public.has_permission('hour_permissions.approve',w.branch_id,w.region_id,stage_role) then raise exception 'reviewer is not assigned to the current approval scope' using errcode='42501'; end if;
 if w.current_stage='branch' then
  update public.request_approval_workflows as approval_workflow set branch_decision=decision_value,branch_reviewed_at=clock_timestamp(),branch_note=nullif(btrim(p_note),''),branch_reviewed_by=reviewer_id,
   current_stage=case when p_approve then 'region' else 'completed' end,current_stage_order=case when p_approve then 2 else current_stage_order end,
   status=case when p_approve then 'pending' else 'rejected' end,final_status=case when p_approve then null else 'rejected' end,
   completed_at=case when p_approve then null else clock_timestamp() end,updated_at=clock_timestamp()
  where approval_workflow.id=w.id and approval_workflow.company_id=c;
  if p_approve then
   next_stage:='region';
  else
   update public.employee_hour_permissions as hourly_permission set status='rejected',review_note=nullif(btrim(p_note),''),reviewed_by_employee_id=reviewer_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where hourly_permission.id=r.id and hourly_permission.company_id=c;
  end if;
 else
  update public.request_approval_workflows as approval_workflow set region_decision=decision_value,region_reviewed_at=clock_timestamp(),region_note=nullif(btrim(p_note),''),region_reviewed_by=reviewer_id,
   current_stage='completed',current_stage_order=2,status=decision_value,final_status=decision_value,completed_at=clock_timestamp(),updated_at=clock_timestamp()
  where approval_workflow.id=w.id and approval_workflow.company_id=c;
  update public.employee_hour_permissions as hourly_permission set status=decision_value,review_note=nullif(btrim(p_note),''),reviewed_by_employee_id=reviewer_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where hourly_permission.id=r.id and hourly_permission.company_id=c;
 end if;
 if next_stage='region' then
  insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
  select c,m.employee_id,m.user_id,'hour_permission.awaiting_region_review','طلب إذن بانتظار اعتماد المنطقة','تم اعتماد الطلب في الفرع ويحتاج إلى المراجعة النهائية.','hour_permission',r.id
  from public.company_memberships m join public.employee_roles er on er.employee_id=m.employee_id
  join public.roles ro on ro.id=er.role_id and ro.company_id=c and ro.code='AREA_MANAGER' and ro.is_active
  where m.company_id=c and m.status='active' and exists(select 1 from public.employee_scope_assignments a where a.employee_id=m.employee_id and a.role_id=ro.id and a.company_id=c and a.scope_level='region' and a.scope_id=w.region_id);
 else
  insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
  select c,r.employee_id,m.user_id,'hour_permission.'||decision_value,'تحديث طلب إذن الساعات',case when p_approve then 'تم اعتماد طلب إذن الساعات.' else 'تم رفض طلب إذن الساعات.' end,'hour_permission',r.id
  from public.company_memberships m where m.company_id=c and m.employee_id=r.employee_id and m.status='active';
 end if;
 perform app_private.audit_company_action(c,'hour_permission.'||w.current_stage||'.'||decision_value,'hour_permission',r.id,to_jsonb(r),jsonb_build_object('status',decision_value,'note',p_note,'workflow_id',w.id));
 return jsonb_build_object('ok',true,'stage',coalesce(next_stage,'completed'),'message',case when next_stage='region' then 'تم اعتماد الطلب في الفرع وإرساله للاعتماد النهائي.' when p_approve then 'تم اعتماد الإذن.' else 'تم رفض الإذن.' end);
end; $$;
revoke all on function public.app_review_hour_permission(uuid,boolean,text) from public,anon;
grant execute on function public.app_review_hour_permission(uuid,boolean,text) to authenticated;
create function public.app_review_hour_permission_v2(p_permission_id uuid,p_approve boolean,p_note text) returns jsonb
language sql security definer set search_path='' as $$ select public.app_review_hour_permission(p_permission_id,p_approve,p_note) $$;
revoke all on function public.app_review_hour_permission_v2(uuid,boolean,text) from public,anon;
grant execute on function public.app_review_hour_permission_v2(uuid,boolean,text) to authenticated;
