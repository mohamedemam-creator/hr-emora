-- Tenant-scoped shift contracts used by app/dashboard/shifts and reports.
-- All reads and writes are RPC-only; browser table grants remain revoked.

create function app_private.require_shift_permission(p_code text)
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id();
begin
 if auth.uid() is null or c is null or not public.has_permission(p_code)
   and not (p_code='shifts.view_own' and public.has_permission('shifts.manage_branch')) then
  raise exception 'shift permission required' using errcode='42501';
 end if;
 return c;
end; $$;
revoke all on function app_private.require_shift_permission(text) from public,anon,authenticated;

create function public.app_shift_edit_policy() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
 return jsonb_build_object('today',clock_timestamp()::date,'can_manage_past',public.has_permission('shifts.manage_past'));
end; $$;
revoke all on function public.app_shift_edit_policy() from public,anon;
grant execute on function public.app_shift_edit_policy() to authenticated;

create function public.app_list_shift_leave_types() returns setof public.leave_types
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.view_own');
begin return query select l.* from public.leave_types l where l.company_id=c and l.is_active order by l.name; end; $$;
revoke all on function public.app_list_shift_leave_types() from public,anon;
grant execute on function public.app_list_shift_leave_types() to authenticated;

create function public.app_shift_workspace(p_branch_id uuid default null,p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.view_own'); week_value date:=coalesce(p_week_start,date_trunc('week',current_date)::date);
 can_manage_value boolean:=public.has_permission('shifts.manage_branch'); can_publish_value boolean:=public.has_permission('shifts.publish');
 selected_branch uuid:=p_branch_id;
begin
 if selected_branch is not null and not exists(select 1 from public.branches b where b.id=selected_branch and b.company_id=c and b.is_active) then
  raise exception 'branch is outside company' using errcode='42501'; end if;
 if selected_branch is null then select b.id into selected_branch from public.branches b where b.company_id=c and b.is_active order by b.name limit 1; end if;
 if selected_branch is null then return jsonb_build_object('selected_branch_id',null,'week_start',week_value,'branches','[]'::jsonb,'employees','[]'::jsonb,'templates','[]'::jsonb,'assignments','[]'::jsonb,'can_manage',can_manage_value,'can_publish',can_publish_value); end if;
 return jsonb_build_object(
  'selected_branch_id',selected_branch,'week_start',week_value,
  'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code) order by b.name),'[]'::jsonb) from public.branches b where b.company_id=c and b.is_active),
  'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'full_name',e.full_name,'job_title',j.name,'branch_id',e.branch_id,'branch_name',b.name,'branch_code',b.code) order by e.full_name),'[]'::jsonb) from public.employees e left join public.job_titles j on j.id=e.job_title_id and j.company_id=c left join public.branches b on b.id=e.branch_id and b.company_id=c where e.company_id=c and e.employment_status='active' and e.deleted_at is null and e.branch_id=selected_branch),
  'templates',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'start_time',to_char(t.start_time,'HH24:MI'),'end_time',to_char(t.end_time,'HH24:MI'),'grace_minutes',t.grace_minutes,'break_minutes',t.break_minutes,'is_break_paid',t.is_break_paid,'is_active',t.is_active) order by t.name),'[]'::jsonb) from public.shift_templates t where t.company_id=c and t.is_active and (t.branch_id is null or t.branch_id=selected_branch)),
  'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,'branch_id',a.branch_id,'shift_template_id',a.shift_template_id,'shift_date',a.shift_date,'day_type',a.day_type,'start_time',case when a.planned_start is null then null else to_char(a.planned_start,'HH24:MI') end,'end_time',case when a.planned_end is null then null else to_char(a.planned_end,'HH24:MI') end,'status',a.status,'notes',a.notes) order by a.shift_date,e.full_name),'[]'::jsonb) from public.shift_assignments a join public.employees e on e.id=a.employee_id and e.company_id=c where a.company_id=c and a.branch_id=selected_branch and a.shift_date between week_value and week_value+6 and a.status<>'cancelled'),
  'can_manage',can_manage_value,'can_publish',can_publish_value);
end; $$;
revoke all on function public.app_shift_workspace(uuid,date) from public,anon;
grant execute on function public.app_shift_workspace(uuid,date) to authenticated;

create function public.app_save_shift_template(p_template_id uuid,p_branch_id uuid,p_name text,p_code text,p_start_time time,p_end_time time,p_grace_minutes integer,p_break_minutes integer,p_is_break_paid boolean,p_is_active boolean) returns uuid
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.manage_branch'); tid uuid:=p_template_id; old_row public.shift_templates;
begin
 if nullif(btrim(p_name),'') is null or nullif(btrim(p_code),'') is null or p_start_time is null or p_end_time is null
   or p_grace_minutes not between 0 and 480 or p_break_minutes not between 0 and 720 then raise exception 'invalid shift template' using errcode='22023'; end if;
 if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside company' using errcode='42501'; end if;
 if tid is null then insert into public.shift_templates(company_id,branch_id,name,code,start_time,end_time,grace_minutes,break_minutes,is_break_paid,is_active)
  values(c,p_branch_id,btrim(p_name),upper(btrim(p_code)),p_start_time,p_end_time,p_grace_minutes,p_break_minutes,coalesce(p_is_break_paid,false),coalesce(p_is_active,true)) returning id into tid;
 else select * into old_row from public.shift_templates where id=tid and company_id=c for update;
  if not found then raise exception 'template not found' using errcode='42501'; end if;
  update public.shift_templates set branch_id=p_branch_id,name=btrim(p_name),code=upper(btrim(p_code)),start_time=p_start_time,end_time=p_end_time,grace_minutes=p_grace_minutes,break_minutes=p_break_minutes,is_break_paid=coalesce(p_is_break_paid,false),is_active=coalesce(p_is_active,true),updated_at=clock_timestamp() where id=tid and company_id=c;
 end if;
 perform app_private.audit_company_action(c,'shift.template_saved','shift_template',tid,case when p_template_id is null then null else to_jsonb(old_row) end,jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code)),'branch_id',p_branch_id,'active',coalesce(p_is_active,true)));
 return tid;
end; $$;
revoke all on function public.app_save_shift_template(uuid,uuid,text,text,time,time,integer,integer,boolean,boolean) from public,anon;
grant execute on function public.app_save_shift_template(uuid,uuid,text,text,time,time,integer,integer,boolean,boolean) to authenticated;

create function public.app_delete_shift_template(p_template_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.manage_branch'); t public.shift_templates; linked_count bigint;
begin
 select * into t from public.shift_templates where id=p_template_id and company_id=c for update;
 if not found then raise exception 'template not found' using errcode='42501'; end if;
 select count(*) into linked_count from public.shift_assignments where company_id=c and shift_template_id=t.id;
 if linked_count>0 then update public.shift_templates set is_active=false,updated_at=clock_timestamp() where id=t.id and company_id=c;
 else delete from public.shift_templates where id=t.id and company_id=c; end if;
 perform app_private.audit_company_action(c,'shift.template_deleted','shift_template',t.id,to_jsonb(t),jsonb_build_object('archived',linked_count>0,'linked_assignments',linked_count));
 return jsonb_build_object('deleted',true,'linked_assignments',linked_count,'name',t.name);
end; $$;
revoke all on function public.app_delete_shift_template(uuid) from public,anon;
grant execute on function public.app_delete_shift_template(uuid) to authenticated;

create function public.app_publish_shift_week(p_branch_id uuid,p_week_start date) returns integer
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.publish'); n integer;
begin
 if p_week_start is null or p_branch_id is null or not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c and b.is_active) then raise exception 'invalid branch or week' using errcode='22023'; end if;
 if p_week_start<current_date and not public.has_permission('shifts.manage_past') then raise exception 'past shift publishing is not permitted' using errcode='42501'; end if;
 update public.shift_assignments a set status='published',updated_at=clock_timestamp() where a.company_id=c and a.branch_id=p_branch_id and a.shift_date between p_week_start and p_week_start+6 and a.status='draft';
 get diagnostics n=row_count;
 perform app_private.audit_company_action(c,'shift.week_published','branch',p_branch_id,null,jsonb_build_object('week_start',p_week_start,'published_count',n));
 return n;
end; $$;
revoke all on function public.app_publish_shift_week(uuid,date) from public,anon;
grant execute on function public.app_publish_shift_week(uuid,date) to authenticated;

create function public.app_shift_all_scope_access() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.view_own');
begin return jsonb_build_object('can_use_all',public.has_permission('shifts.manage_branch'),'company_wide',public.has_permission('shifts.manage_branch')); end; $$;
revoke all on function public.app_shift_all_scope_access() from public,anon;
grant execute on function public.app_shift_all_scope_access() to authenticated;

create function public.app_shift_all_accessible_workspace(p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.manage_branch'); w date:=coalesce(p_week_start,date_trunc('week',current_date)::date);
begin
 return jsonb_build_object('selected_branch_id',null,'week_start',w,'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code) order by b.name),'[]'::jsonb) from public.branches b where b.company_id=c and b.is_active),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'full_name',e.full_name,'job_title',j.name,'branch_id',e.branch_id,'branch_name',b.name,'branch_code',b.code) order by e.full_name),'[]'::jsonb) from public.employees e left join public.job_titles j on j.id=e.job_title_id and j.company_id=c left join public.branches b on b.id=e.branch_id and b.company_id=c where e.company_id=c and e.employment_status='active' and e.deleted_at is null),
 'templates','[]'::jsonb,'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,'branch_id',a.branch_id,'shift_template_id',a.shift_template_id,'shift_date',a.shift_date,'day_type',a.day_type,'start_time',case when a.planned_start is null then null else to_char(a.planned_start,'HH24:MI') end,'end_time',case when a.planned_end is null then null else to_char(a.planned_end,'HH24:MI') end,'status',a.status,'notes',a.notes) order by a.shift_date,e.full_name),'[]'::jsonb) from public.shift_assignments a join public.employees e on e.id=a.employee_id and e.company_id=c where a.company_id=c and a.shift_date between w and w+6 and a.status<>'cancelled'),
 'can_manage',false,'can_publish',false,'can_use_all',true,'company_wide',true);
end; $$;
revoke all on function public.app_shift_all_accessible_workspace(date) from public,anon;
grant execute on function public.app_shift_all_accessible_workspace(date) to authenticated;

create function public.app_list_shift_change_requests(p_branch_id uuid default null,p_week_start date default null)
returns table(id uuid,request_type text,employee_id uuid,employee_code text,employee_name text,shift_date date,
 requested_day_type text,requested_start text,requested_end text,leave_type_name text,requester_name text,requested_at timestamptz,can_review boolean)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.view_own'); w date:=coalesce(p_week_start,date_trunc('week',current_date)::date);
begin
 if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside company' using errcode='42501'; end if;
 return query select q.id,q.request_type,e.id,e.employee_code,e.full_name,q.shift_date,q.requested_day_type,
  case when q.requested_start is null then null else to_char(q.requested_start,'HH24:MI') end,
  case when q.requested_end is null then null else to_char(q.requested_end,'HH24:MI') end,lt.name,req.full_name,q.requested_at,
  public.has_permission('shifts.manage_branch')
 from public.shift_change_requests q join public.employees e on e.id=q.employee_id and e.company_id=c
 left join public.employees req on req.id=q.requested_by and req.company_id=c
 left join public.leave_types lt on lt.id=q.leave_type_id and lt.company_id=c
 where q.company_id=c and q.status='pending' and q.shift_date between w and w+6 and (p_branch_id is null or q.branch_id=p_branch_id)
 order by q.requested_at;
end; $$;
revoke all on function public.app_list_shift_change_requests(uuid,date) from public,anon;
grant execute on function public.app_list_shift_change_requests(uuid,date) to authenticated;

create or replace function public.app_request_shift_change(p_assignment_id uuid,p_employee_id uuid,p_branch_id uuid,p_template_id uuid,p_shift_date date,p_day_type text,p_start_time time,p_end_time time,p_status text,p_notes text,p_leave_type_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.view_own'); actor uuid:=public.current_employee_id(); direct_value boolean:=public.has_permission('shifts.manage_branch'); old_row public.shift_assignments; aid uuid;
begin
 if actor is null or not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=c and e.deleted_at is null and e.employment_status='active')
  or not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c and b.is_active) then raise exception 'employee or branch is outside company' using errcode='42501'; end if;
 if not direct_value and actor<>p_employee_id then raise exception 'employees may request changes only to their own shifts' using errcode='42501'; end if;
 if p_day_type not in ('work','off','leave','mission') or (p_day_type='work' and (p_start_time is null or p_end_time is null))
  or (p_day_type='leave' and (p_leave_type_id is null or not exists(select 1 from public.leave_types l where l.id=p_leave_type_id and l.company_id=c and l.is_active))) then raise exception 'invalid shift values' using errcode='22023'; end if;
 if p_template_id is not null and not exists(select 1 from public.shift_templates t where t.id=p_template_id and t.company_id=c and t.is_active and (t.branch_id is null or t.branch_id=p_branch_id)) then raise exception 'template is unavailable for this branch' using errcode='22023'; end if;
 if p_shift_date<current_date and not public.has_permission('shifts.manage_past') then raise exception 'past shift editing is not permitted' using errcode='42501'; end if;
 if p_assignment_id is not null then select * into old_row from public.shift_assignments a where a.id=p_assignment_id and a.company_id=c and a.employee_id=p_employee_id and a.branch_id=p_branch_id and a.shift_date=p_shift_date for update;
  if not found then raise exception 'assignment is outside the selected company, employee, branch, or date' using errcode='42501'; end if;
 end if;
 if direct_value then
  if p_assignment_id is null then
   select assignment.* into old_row from public.shift_assignments as assignment
    where assignment.company_id=c and assignment.employee_id=p_employee_id and assignment.shift_date=p_shift_date
    for update;
   insert into public.shift_assignments(company_id,employee_id,branch_id,shift_template_id,shift_date,day_type,planned_start,planned_end,status,notes,created_by)
   values(c,p_employee_id,p_branch_id,p_template_id,p_shift_date,p_day_type,p_start_time,p_end_time,case when p_status='published' then 'published' else 'draft' end,nullif(btrim(p_notes),''),auth.uid())
   on conflict(employee_id,shift_date) do update set branch_id=excluded.branch_id,shift_template_id=excluded.shift_template_id,
    day_type=excluded.day_type,planned_start=excluded.planned_start,planned_end=excluded.planned_end,
    status=excluded.status,notes=excluded.notes,updated_at=clock_timestamp()
   where public.shift_assignments.company_id=c returning id into aid;
   if aid is null then raise exception 'shift assignment could not be saved in the active company' using errcode='42501'; end if;
  else update public.shift_assignments set shift_template_id=p_template_id,day_type=p_day_type,planned_start=p_start_time,planned_end=p_end_time,status=case when p_status='published' then 'published' else 'draft' end,notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp() where id=p_assignment_id and company_id=c returning id into aid; end if;
  perform app_private.audit_company_action(c,'shift.assignment_saved','shift_assignment',aid,case when old_row.id is null then null else to_jsonb(old_row) end,jsonb_build_object('employee_id',p_employee_id,'branch_id',p_branch_id,'shift_date',p_shift_date,'day_type',p_day_type,'status',p_status));
  return jsonb_build_object('applied',true,'pending',false,'message','تم حفظ الشيفت.');
 end if;
 insert into public.shift_change_requests(company_id,assignment_id,employee_id,branch_id,shift_template_id,shift_date,request_type,requested_day_type,requested_start,requested_end,requested_status,leave_type_id,notes,old_data,new_data,requested_by)
 values(c,p_assignment_id,p_employee_id,p_branch_id,p_template_id,p_shift_date,'upsert',p_day_type,p_start_time,p_end_time,coalesce(p_status,'draft'),p_leave_type_id,nullif(btrim(p_notes),''),case when p_assignment_id is null then null else to_jsonb(old_row) end,
 jsonb_build_object('day_type',p_day_type,'start_time',p_start_time,'end_time',p_end_time,'status',coalesce(p_status,'draft'),'notes',p_notes,'template_id',p_template_id,'leave_type_id',p_leave_type_id),actor);
 return jsonb_build_object('applied',false,'pending',true,'message','تم إرسال طلب تعديل الشيفت للمراجعة.');
end; $$;
revoke all on function public.app_request_shift_change(uuid,uuid,uuid,uuid,date,text,time,time,text,text,uuid) from public,anon;
grant execute on function public.app_request_shift_change(uuid,uuid,uuid,uuid,date,text,time,time,text,text,uuid) to authenticated;

create function public.app_request_shift_delete(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.view_own'); actor uuid:=public.current_employee_id(); a public.shift_assignments;
begin
 select * into a from public.shift_assignments where id=p_assignment_id and company_id=c for update;
 if not found then raise exception 'assignment not found' using errcode='42501'; end if;
 if actor is null or (not public.has_permission('shifts.manage_branch') and actor<>a.employee_id) then raise exception 'employees may request deletion only for their own shifts' using errcode='42501'; end if;
 if a.shift_date<current_date and not public.has_permission('shifts.manage_past') then raise exception 'past shift editing is not permitted' using errcode='42501'; end if;
 if public.has_permission('shifts.manage_branch') then
  update public.shift_assignments set status='cancelled',updated_at=clock_timestamp() where id=a.id and company_id=c;
  perform app_private.audit_company_action(c,'shift.assignment_cancelled','shift_assignment',a.id,to_jsonb(a),jsonb_build_object('status','cancelled'));
  return jsonb_build_object('pending',false,'message','تم حذف الشيفت.');
 end if;
 insert into public.shift_change_requests(company_id,assignment_id,employee_id,branch_id,shift_template_id,shift_date,request_type,old_data,requested_by)
 values(c,a.id,a.employee_id,a.branch_id,a.shift_template_id,a.shift_date,'delete',to_jsonb(a),actor);
 return jsonb_build_object('pending',true,'message','تم إرسال طلب حذف الشيفت للمراجعة.');
end; $$;
revoke all on function public.app_request_shift_delete(uuid) from public,anon;
grant execute on function public.app_request_shift_delete(uuid) to authenticated;

create or replace function public.app_review_shift_change_request(p_request_id uuid,p_decision text,p_notes text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.manage_branch'); q public.shift_change_requests; new_value jsonb; saved_assignment_id uuid;
begin
 if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
 select * into q from public.shift_change_requests where id=p_request_id and company_id=c and status='pending' for update;
 if not found then raise exception 'pending request not found' using errcode='42501'; end if;
 if q.shift_date<current_date and not public.has_permission('shifts.manage_past') then raise exception 'past shift review is not permitted' using errcode='42501'; end if;
 if p_decision='approved' then
  if q.request_type='delete' then update public.shift_assignments set status='cancelled',updated_at=clock_timestamp() where id=q.assignment_id and company_id=c;
  else new_value:=q.new_data;
   if q.assignment_id is null then
    insert into public.shift_assignments(company_id,employee_id,branch_id,shift_template_id,shift_date,day_type,planned_start,planned_end,status,notes,created_by)
    values(c,q.employee_id,q.branch_id,q.shift_template_id,q.shift_date,new_value->>'day_type',(new_value->>'start_time')::time,(new_value->>'end_time')::time,coalesce(new_value->>'status','draft'),new_value->>'notes',auth.uid())
    on conflict(employee_id,shift_date) do update set branch_id=excluded.branch_id,shift_template_id=excluded.shift_template_id,
     day_type=excluded.day_type,planned_start=excluded.planned_start,planned_end=excluded.planned_end,
     status=excluded.status,notes=excluded.notes,updated_at=clock_timestamp()
    where public.shift_assignments.company_id=c returning id into saved_assignment_id;
    if saved_assignment_id is null then raise exception 'shift assignment could not be saved in the active company' using errcode='42501'; end if;
   else
    update public.shift_assignments set shift_template_id=q.shift_template_id,day_type=new_value->>'day_type',planned_start=(new_value->>'start_time')::time,planned_end=(new_value->>'end_time')::time,status=coalesce(new_value->>'status','draft'),notes=new_value->>'notes',updated_at=clock_timestamp() where id=q.assignment_id and company_id=c returning id into saved_assignment_id;
    if saved_assignment_id is null then raise exception 'shift assignment no longer exists in the active company' using errcode='P0002'; end if;
   end if;
  end if;
 end if;
 update public.shift_change_requests set status=p_decision,reviewed_by=public.current_employee_id(),reviewed_at=clock_timestamp(),reviewer_notes=nullif(btrim(p_notes),'') where id=q.id and company_id=c;
 perform app_private.audit_company_action(c,'shift.request_reviewed','shift_change_request',q.id,to_jsonb(q),jsonb_build_object('decision',p_decision,'notes',p_notes));
end; $$;
revoke all on function public.app_review_shift_change_request(uuid,text,text) from public,anon;
grant execute on function public.app_review_shift_change_request(uuid,text,text) to authenticated;

create function public.app_import_shifts(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_shift_permission('shifts.manage_branch'); row_value jsonb; row_no integer:=0; saved_count integer:=0; failed_count integer:=0; errors_value jsonb:='[]'::jsonb;
 employee_value public.employees; branch_value public.branches; day_value text; date_value date; start_value time; end_value time; status_value text; message_value text;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception 'rows must be a JSON array with at most 5000 items' using errcode='22023'; end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  row_no:=row_no+1; message_value:=null;
  begin
   select * into employee_value from public.employees e where e.company_id=c and e.employee_code=btrim(row_value->>'employee_code') and e.employment_status='active' and e.deleted_at is null;
   select * into branch_value from public.branches b where b.company_id=c and b.code=upper(btrim(row_value->>'branch_code')) and b.is_active;
   day_value:=coalesce(row_value->>'day_type','work'); date_value:=(row_value->>'shift_date')::date;
   start_value:=nullif(row_value->>'start_time','')::time; end_value:=nullif(row_value->>'end_time','')::time;
   status_value:=coalesce(row_value->>'status','draft');
   if employee_value.id is null then message_value:='employee not found or inactive';
   elsif branch_value.id is null then message_value:='branch not found or inactive';
   elsif day_value not in ('work','off','leave','mission') then message_value:='invalid day_type';
   elsif status_value<>'draft' then message_value:='imports can only create draft shifts';
   elsif day_value='work' and (start_value is null or end_value is null) then message_value:='work shifts require start_time and end_time';
   elsif date_value<current_date and not public.has_permission('shifts.manage_past') then message_value:='past shift import is not permitted';
   else
    insert into public.shift_assignments(company_id,employee_id,branch_id,shift_date,day_type,planned_start,planned_end,status,notes,created_by)
    values(c,employee_value.id,branch_value.id,date_value,day_value,start_value,end_value,'draft',nullif(btrim(row_value->>'notes'),''),auth.uid())
    on conflict(employee_id,shift_date) do update set branch_id=excluded.branch_id,day_type=excluded.day_type,planned_start=excluded.planned_start,planned_end=excluded.planned_end,status='draft',notes=excluded.notes,updated_at=clock_timestamp()
    where public.shift_assignments.company_id=c and public.shift_assignments.status='draft';
    if found then saved_count:=saved_count+1; else message_value:='existing assignment is not a draft or belongs to another company'; end if;
   end if;
  exception when others then message_value:=sqlerrm; end;
  if message_value is not null then
   failed_count:=failed_count+1;
   errors_value:=errors_value||jsonb_build_array(jsonb_build_object('row',row_no,'employee_code',row_value->>'employee_code','error',message_value));
  end if;
 end loop;
 perform app_private.audit_company_action(c,'shift.imported','shift_assignment',null,null,jsonb_build_object('saved',saved_count,'failed',failed_count));
 return jsonb_build_object('saved',saved_count,'failed',failed_count,'errors',errors_value);
end; $$;
revoke all on function public.app_import_shifts(jsonb) from public,anon;
grant execute on function public.app_import_shifts(jsonb) to authenticated;
