-- Make manager saves and approved employee shift requests concurrency-safe.
-- The unique key is employee_id + shift_date; all conflict updates remain
-- constrained to the authenticated company context.

create or replace function public.app_request_shift_change(
 p_assignment_id uuid,p_employee_id uuid,p_branch_id uuid,p_template_id uuid,
 p_shift_date date,p_day_type text,p_start_time time,p_end_time time,p_status text,
 p_notes text,p_leave_type_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 c uuid:=app_private.require_shift_permission('shifts.view_own');
 actor uuid:=public.current_employee_id();
 direct_value boolean:=public.has_permission('shifts.manage_branch');
 old_row public.shift_assignments;
 assignment_id_value uuid;
begin
 if actor is null or not exists(
  select 1 from public.employees as employee
  where employee.id=p_employee_id and employee.company_id=c
   and employee.deleted_at is null and employee.employment_status='active'
 ) or not exists(
  select 1 from public.branches as branch
  where branch.id=p_branch_id and branch.company_id=c and branch.is_active
 ) then raise exception 'employee or branch is outside company' using errcode='42501'; end if;
 if not direct_value and actor<>p_employee_id then
  raise exception 'employees may request changes only to their own shifts' using errcode='42501';
 end if;
 if p_day_type not in ('work','off','leave','mission')
  or (p_day_type='work' and (p_start_time is null or p_end_time is null))
  or (p_day_type='leave' and (p_leave_type_id is null or not exists(
   select 1 from public.leave_types as leave_type
   where leave_type.id=p_leave_type_id and leave_type.company_id=c and leave_type.is_active
  ))) then raise exception 'invalid shift values' using errcode='22023'; end if;
 if p_template_id is not null and not exists(
  select 1 from public.shift_templates as template
  where template.id=p_template_id and template.company_id=c and template.is_active
   and (template.branch_id is null or template.branch_id=p_branch_id)
 ) then raise exception 'template is unavailable for this branch' using errcode='22023'; end if;
 if p_shift_date<current_date and not public.has_permission('shifts.manage_past') then
  raise exception 'past shift editing is not permitted' using errcode='42501';
 end if;
 if p_assignment_id is not null then
  select assignment.* into old_row from public.shift_assignments as assignment
  where assignment.id=p_assignment_id and assignment.company_id=c
   and assignment.employee_id=p_employee_id and assignment.branch_id=p_branch_id
   and assignment.shift_date=p_shift_date for update;
  if not found then raise exception 'assignment is outside the selected company, employee, branch, or date' using errcode='42501'; end if;
 end if;
 if direct_value then
  if p_assignment_id is null then
   select assignment.* into old_row from public.shift_assignments as assignment
   where assignment.company_id=c and assignment.employee_id=p_employee_id
    and assignment.shift_date=p_shift_date for update;
   insert into public.shift_assignments(
    company_id,employee_id,branch_id,shift_template_id,shift_date,day_type,
    planned_start,planned_end,status,notes,created_by
   ) values(
    c,p_employee_id,p_branch_id,p_template_id,p_shift_date,p_day_type,p_start_time,p_end_time,
    case when p_status='published' then 'published' else 'draft' end,
    nullif(btrim(p_notes),''),auth.uid()
   ) on conflict(employee_id,shift_date) do update set
    branch_id=excluded.branch_id,shift_template_id=excluded.shift_template_id,
    day_type=excluded.day_type,planned_start=excluded.planned_start,
    planned_end=excluded.planned_end,status=excluded.status,notes=excluded.notes,
    updated_at=clock_timestamp()
   where public.shift_assignments.company_id=c
   returning id into assignment_id_value;
  else
   update public.shift_assignments as assignment set
    shift_template_id=p_template_id,day_type=p_day_type,planned_start=p_start_time,
    planned_end=p_end_time,status=case when p_status='published' then 'published' else 'draft' end,
    notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp()
   where assignment.id=p_assignment_id and assignment.company_id=c
   returning assignment.id into assignment_id_value;
  end if;
  if assignment_id_value is null then
   raise exception 'shift assignment could not be saved in the active company' using errcode='42501';
  end if;
  perform app_private.audit_company_action(
   c,'shift.assignment_saved','shift_assignment',assignment_id_value,
   case when old_row.id is null then null else to_jsonb(old_row) end,
   jsonb_build_object('employee_id',p_employee_id,'branch_id',p_branch_id,
    'shift_date',p_shift_date,'day_type',p_day_type,'status',p_status)
  );
  return jsonb_build_object('applied',true,'pending',false,'message','تم حفظ الشيفت.');
 end if;
 insert into public.shift_change_requests(
  company_id,assignment_id,employee_id,branch_id,shift_template_id,shift_date,
  request_type,requested_day_type,requested_start,requested_end,requested_status,
  leave_type_id,notes,old_data,new_data,requested_by
 ) values(
  c,p_assignment_id,p_employee_id,p_branch_id,p_template_id,p_shift_date,'upsert',
  p_day_type,p_start_time,p_end_time,coalesce(p_status,'draft'),p_leave_type_id,
  nullif(btrim(p_notes),''),case when p_assignment_id is null then null else to_jsonb(old_row) end,
  jsonb_build_object('day_type',p_day_type,'start_time',p_start_time,'end_time',p_end_time,
   'status',coalesce(p_status,'draft'),'notes',p_notes,'template_id',p_template_id,
   'leave_type_id',p_leave_type_id),actor
 );
 return jsonb_build_object('applied',false,'pending',true,'message','تم إرسال طلب تعديل الشيفت للمراجعة.');
end;
$$;
revoke all on function public.app_request_shift_change(uuid,uuid,uuid,uuid,date,text,time,time,text,text,uuid) from public,anon;
grant execute on function public.app_request_shift_change(uuid,uuid,uuid,uuid,date,text,time,time,text,text,uuid) to authenticated;

create or replace function public.app_review_shift_change_request(p_request_id uuid,p_decision text,p_notes text) returns void
language plpgsql security definer set search_path=''
as $$
declare
 c uuid:=app_private.require_shift_permission('shifts.manage_branch');
 q public.shift_change_requests;
 new_value jsonb;
 assignment_id_value uuid;
begin
 if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode='22023'; end if;
 select request.* into q from public.shift_change_requests as request
 where request.id=p_request_id and request.company_id=c and request.status='pending' for update;
 if not found then raise exception 'pending request not found' using errcode='42501'; end if;
 if q.shift_date<current_date and not public.has_permission('shifts.manage_past') then
  raise exception 'past shift review is not permitted' using errcode='42501';
 end if;
 if p_decision='approved' then
  if q.request_type='delete' then
   update public.shift_assignments as assignment set status='cancelled',updated_at=clock_timestamp()
   where assignment.id=q.assignment_id and assignment.company_id=c;
  else
   new_value:=q.new_data;
   if q.assignment_id is null then
    insert into public.shift_assignments(
     company_id,employee_id,branch_id,shift_template_id,shift_date,day_type,
     planned_start,planned_end,status,notes,created_by
    ) values(
     c,q.employee_id,q.branch_id,q.shift_template_id,q.shift_date,
     new_value->>'day_type',(new_value->>'start_time')::time,(new_value->>'end_time')::time,
     coalesce(new_value->>'status','draft'),new_value->>'notes',auth.uid()
    ) on conflict(employee_id,shift_date) do update set
     branch_id=excluded.branch_id,shift_template_id=excluded.shift_template_id,
     day_type=excluded.day_type,planned_start=excluded.planned_start,
     planned_end=excluded.planned_end,status=excluded.status,notes=excluded.notes,
     updated_at=clock_timestamp()
    where public.shift_assignments.company_id=c
    returning id into assignment_id_value;
   else
    update public.shift_assignments as assignment set
     shift_template_id=q.shift_template_id,day_type=new_value->>'day_type',
     planned_start=(new_value->>'start_time')::time,planned_end=(new_value->>'end_time')::time,
     status=coalesce(new_value->>'status','draft'),notes=new_value->>'notes',
     updated_at=clock_timestamp()
    where assignment.id=q.assignment_id and assignment.company_id=c
    returning assignment.id into assignment_id_value;
   end if;
   if assignment_id_value is null then
    raise exception 'shift assignment could not be saved in the active company' using errcode='42501';
   end if;
  end if;
 end if;
 update public.shift_change_requests as request set status=p_decision,
  reviewed_by=public.current_employee_id(),reviewed_at=clock_timestamp(),
  reviewer_notes=nullif(btrim(p_notes),'')
 where request.id=q.id and request.company_id=c;
 perform app_private.audit_company_action(c,'shift.request_reviewed','shift_change_request',
  q.id,to_jsonb(q),jsonb_build_object('decision',p_decision,'notes',p_notes));
end;
$$;
revoke all on function public.app_review_shift_change_request(uuid,text,text) from public,anon;
grant execute on function public.app_review_shift_change_request(uuid,text,text) to authenticated;
