-- Company penalties: moderators may submit requests; approvers (default owner)
-- may materialize and cancel financial records.

create function public.app_list_penalties()
returns table(id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,penalty_type text,title text,reason text,
 amount numeric,deduction_days numeric,effective_date date,status text,created_by_name text,created_at timestamptz,salary_type text,base_salary numeric,
 day_rate numeric,calculated_day_amount numeric,total_financial_deduction numeric)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); actor uuid:=public.current_employee_id(); can_view_all boolean:=public.has_permission('employees.view_all'); can_view_penalties boolean:=public.has_permission('penalties.view');
begin
 if auth.uid() is null or c is null or actor is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 if not can_view_penalties and not can_view_all then raise exception 'penalty view permission required' using errcode='42501'; end if;
 return query select ep.id,e.id,e.employee_code,e.full_name,b.name,ep.penalty_type,ep.title,ep.reason,coalesce(ep.amount,0),coalesce(ep.deduction_days,0),ep.effective_date,ep.status,creator.full_name,ep.created_at,e.salary_type,coalesce(e.base_salary,0),
  round(case when e.salary_type='monthly' then coalesce(e.base_salary,0)/30.0 when e.salary_type='daily' then coalesce(e.base_salary,0) when e.salary_type='hourly' then coalesce(e.base_salary,0)*8.0 else 0 end,2),
  round(coalesce(ep.deduction_days,0)*case when e.salary_type='monthly' then coalesce(e.base_salary,0)/30.0 when e.salary_type='daily' then coalesce(e.base_salary,0) when e.salary_type='hourly' then coalesce(e.base_salary,0)*8.0 else 0 end,2),
  round(coalesce(ep.amount,0)+coalesce(ep.deduction_days,0)*case when e.salary_type='monthly' then coalesce(e.base_salary,0)/30.0 when e.salary_type='daily' then coalesce(e.base_salary,0) when e.salary_type='hourly' then coalesce(e.base_salary,0)*8.0 else 0 end,2)
 from public.employee_penalties ep join public.employees e on e.id=ep.employee_id and e.company_id=c
 left join public.branches b on b.id=e.branch_id and b.company_id=c
 left join public.employees creator on creator.id=ep.created_by_employee_id and creator.company_id=c
 where ep.company_id=c and (can_view_all or can_view_penalties or ep.employee_id=actor)
 order by ep.effective_date desc,ep.created_at desc;
end; $$;
revoke all on function public.app_list_penalties() from public,anon;
grant execute on function public.app_list_penalties() to authenticated;

create function public.app_list_penalty_approval_requests(p_status text default null)
returns table(id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,penalty_type text,title text,reason text,amount numeric,deduction_days numeric,effective_date date,status text,creator_name text,reviewer_name text,review_note text,created_at timestamptz,can_review boolean)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('penalties.approve');
begin
 return query select q.id,e.id,e.employee_code,e.full_name,b.name,q.penalty_type,q.title,q.reason,q.amount,q.deduction_days,q.effective_date,q.status,creator.full_name,reviewer.full_name,q.review_note,q.created_at,(q.status='pending')
 from public.penalty_approval_requests q join public.employees e on e.id=q.employee_id and e.company_id=c
 left join public.branches b on b.id=q.branch_id and b.company_id=c
 left join public.employees creator on creator.id=q.created_by_employee_id and creator.company_id=c
 left join public.employees reviewer on reviewer.id=q.reviewed_by_employee_id and reviewer.company_id=c
 where q.company_id=c and (p_status is null or q.status=p_status) order by q.created_at desc;
end; $$;
revoke all on function public.app_list_penalty_approval_requests(text) from public,anon;
grant execute on function public.app_list_penalty_approval_requests(text) to authenticated;

create function public.app_save_penalty(p_employee_id uuid,p_penalty_type text,p_title text,p_reason text,p_amount numeric,p_deduction_days numeric,p_effective_date date) returns uuid
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('penalties.manage'); actor uuid:=public.current_employee_id(); target public.employees; penalty_id uuid;
begin
 if not public.has_permission('penalties.approve') then raise exception 'penalty approval permission required for direct creation' using errcode='42501'; end if;
 select * into target from public.employees where id=p_employee_id and company_id=c and deleted_at is null and employment_status='active';
 if not found then raise exception 'active employee not found in company' using errcode='42501'; end if;
 if target.id=actor then raise exception 'cannot issue a penalty to yourself' using errcode='42501'; end if;
 if p_penalty_type not in ('warning','deduction_amount','deduction_days','other') or nullif(btrim(p_title),'') is null or nullif(btrim(p_reason),'') is null
  or coalesce(p_amount,0)<0 or coalesce(p_deduction_days,0)<0 or (p_penalty_type='deduction_amount' and coalesce(p_amount,0)=0) or (p_penalty_type='deduction_days' and coalesce(p_deduction_days,0)=0) then
  raise exception 'invalid penalty values' using errcode='22023'; end if;
 insert into public.employee_penalties(company_id,employee_id,penalty_type,title,reason,amount,deduction_days,effective_date,status,created_by_employee_id)
 values(c,target.id,p_penalty_type,btrim(p_title),btrim(p_reason),coalesce(p_amount,0),coalesce(p_deduction_days,0),coalesce(p_effective_date,current_date),'approved',actor) returning id into penalty_id;
 insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
 select c,target.id,m.user_id,'penalty_added','تم تسجيل جزاء',format('تم تسجيل جزاء بعنوان: %s.',btrim(p_title)),'employee_penalty',penalty_id from public.company_memberships m where m.company_id=c and m.employee_id=target.id and m.status='active';
 perform app_private.audit_company_action(c,'penalty.created','employee_penalty',penalty_id,null,jsonb_build_object('employee_id',target.id,'type',p_penalty_type,'amount',coalesce(p_amount,0),'deduction_days',coalesce(p_deduction_days,0),'effective_date',coalesce(p_effective_date,current_date)));
 return penalty_id;
end; $$;
revoke all on function public.app_save_penalty(uuid,text,text,text,numeric,numeric,date) from public,anon;
grant execute on function public.app_save_penalty(uuid,text,text,text,numeric,numeric,date) to authenticated;

create function public.app_submit_penalty_for_approval(p_employee_id uuid,p_penalty_type text,p_title text,p_reason text,p_amount numeric,p_deduction_days numeric,p_effective_date date) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('penalties.manage'); actor uuid:=public.current_employee_id(); target public.employees; request_id uuid;
begin
 if public.has_permission('penalties.approve') then raise exception 'approvers may create penalties directly' using errcode='22023'; end if;
 select * into target from public.employees where id=p_employee_id and company_id=c and deleted_at is null and employment_status='active';
 if not found then raise exception 'active employee not found in company' using errcode='42501'; end if;
 if target.id=actor then raise exception 'cannot request a penalty against yourself' using errcode='42501'; end if;
 if p_penalty_type not in ('warning','deduction_amount','deduction_days','other') or nullif(btrim(p_title),'') is null or nullif(btrim(p_reason),'') is null
  or coalesce(p_amount,0)<0 or coalesce(p_deduction_days,0)<0 or (p_penalty_type='deduction_amount' and coalesce(p_amount,0)=0) or (p_penalty_type='deduction_days' and coalesce(p_deduction_days,0)=0) then
  raise exception 'invalid penalty values' using errcode='22023'; end if;
 insert into public.penalty_approval_requests(company_id,employee_id,branch_id,region_id,penalty_type,title,reason,amount,deduction_days,effective_date,created_by_employee_id)
 select c,target.id,target.branch_id,b.region_id,p_penalty_type,btrim(p_title),btrim(p_reason),coalesce(p_amount,0),coalesce(p_deduction_days,0),coalesce(p_effective_date,current_date),actor
 from public.branches b where b.id=target.branch_id and b.company_id=c returning id into request_id;
 if request_id is null then
  insert into public.penalty_approval_requests(company_id,employee_id,penalty_type,title,reason,amount,deduction_days,effective_date,created_by_employee_id)
  values(c,target.id,p_penalty_type,btrim(p_title),btrim(p_reason),coalesce(p_amount,0),coalesce(p_deduction_days,0),coalesce(p_effective_date,current_date),actor) returning id into request_id;
 end if;
 insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
 select c,m.employee_id,m.user_id,'penalty.review_requested','مطلوب اعتماد جزاء',format('طلب اعتماد جزاء للموظف %s.',target.full_name),'penalty_request',request_id
 from public.company_memberships m where m.company_id=c and m.status='active' and exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id and r.company_id=c where er.employee_id=m.employee_id and r.is_active and r.code='COMPANY_OWNER');
 perform app_private.audit_company_action(c,'penalty.submitted_for_approval','penalty_approval_request',request_id,null,jsonb_build_object('employee_id',target.id,'type',p_penalty_type,'amount',coalesce(p_amount,0),'deduction_days',coalesce(p_deduction_days,0)));
 return jsonb_build_object('ok',true,'request_id',request_id,'message','تم إرسال الجزاء إلى مالك الشركة للمراجعة.');
end; $$;
revoke all on function public.app_submit_penalty_for_approval(uuid,text,text,text,numeric,numeric,date) from public,anon;
grant execute on function public.app_submit_penalty_for_approval(uuid,text,text,text,numeric,numeric,date) to authenticated;

create function public.app_review_penalty_request(p_request_id uuid,p_approve boolean,p_note text default null) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('penalties.approve'); actor uuid:=public.current_employee_id(); q public.penalty_approval_requests; penalty_id uuid;
begin
 select * into q from public.penalty_approval_requests where id=p_request_id and company_id=c and status='pending' for update;
 if not found then raise exception 'pending penalty request not found' using errcode='P0002'; end if;
 if actor=q.employee_id or actor=q.created_by_employee_id then raise exception 'requester or affected employee cannot approve this request' using errcode='42501'; end if;
 if p_approve then
  penalty_id:=public.app_save_penalty(q.employee_id,q.penalty_type,q.title,q.reason,q.amount,q.deduction_days,q.effective_date);
  update public.employee_penalties set created_by_employee_id=q.created_by_employee_id where id=penalty_id and company_id=c;
 end if;
 update public.penalty_approval_requests set status=case when p_approve then 'approved' else 'rejected' end,materialized_penalty_id=penalty_id,
  reviewed_by_employee_id=actor,reviewed_at=clock_timestamp(),review_note=nullif(btrim(p_note),''),updated_at=clock_timestamp() where id=q.id and company_id=c;
 insert into public.notifications(company_id,recipient_employee_id,user_id,notification_type,title,body,entity_type,entity_id)
 select c,q.employee_id,m.user_id,'penalty.request_reviewed','تمت مراجعة طلب الجزاء',case when p_approve then 'تم اعتماد طلب الجزاء.' else 'تم رفض طلب الجزاء.' end,'penalty_request',q.id from public.company_memberships m where m.company_id=c and m.employee_id=q.employee_id and m.status='active';
 perform app_private.audit_company_action(c,case when p_approve then 'penalty.request_approved' else 'penalty.request_rejected' end,'penalty_approval_request',q.id,to_jsonb(q),jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,'note',p_note,'penalty_id',penalty_id));
 return jsonb_build_object('ok',true,'status',case when p_approve then 'approved' else 'rejected' end,'message',case when p_approve then 'تم اعتماد الجزاء.' else 'تم رفض طلب الجزاء.' end);
end; $$;
revoke all on function public.app_review_penalty_request(uuid,boolean,text) from public,anon;
grant execute on function public.app_review_penalty_request(uuid,boolean,text) to authenticated;

create function public.app_cancel_penalty(p_penalty_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('penalties.approve'); actor uuid:=public.current_employee_id(); p public.employee_penalties;
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'cancellation reason is required' using errcode='22023'; end if;
 select * into p from public.employee_penalties where id=p_penalty_id and company_id=c and status='approved' for update;
 if not found then raise exception 'approved penalty not found' using errcode='P0002'; end if;
 update public.employee_penalties set status='cancelled',cancelled_by=actor,cancelled_at=clock_timestamp(),cancellation_reason=btrim(p_reason),updated_at=clock_timestamp() where id=p.id and company_id=c;
 perform app_private.audit_company_action(c,'penalty.cancelled','employee_penalty',p.id,to_jsonb(p),jsonb_build_object('status','cancelled','reason',btrim(p_reason)));
end; $$;
revoke all on function public.app_cancel_penalty(uuid,text) from public,anon;
grant execute on function public.app_cancel_penalty(uuid,text) to authenticated;
