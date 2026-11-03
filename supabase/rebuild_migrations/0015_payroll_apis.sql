-- Tenant-scoped payroll workspace and lifecycle. Calculation inputs are the
-- published shift schedule, validated attendance, approved leave/penalties,
-- and company payroll_settings. Monthly salaried daily hours default to 9
-- (existing product rule); hourly penalties use the historical 8-hour day.

create function public.app_can_manage_company_payroll() returns boolean
language sql stable security definer set search_path=''
as $$ select public.has_permission('payroll.manage') $$;
revoke all on function public.app_can_manage_company_payroll() from public,anon;
grant execute on function public.app_can_manage_company_payroll() to authenticated;

create function public.app_payroll_workspace(p_month date) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); month_value date:=date_trunc('month',coalesce(p_month,current_date))::date; end_value date; cycle public.payroll_cycles; settings public.payroll_settings;
begin
 if auth.uid() is null or c is null or not (public.has_permission('payroll.view') or public.has_permission('payroll.manage')) then raise exception 'payroll view permission required' using errcode='42501'; end if;
 end_value:=(month_value+interval '1 month - 1 day')::date;
 select * into settings from public.payroll_settings where company_id=c;
 select * into cycle from public.payroll_cycles where company_id=c and period_start=month_value and period_end=end_value;
 return jsonb_build_object('month_start',month_value,'month_end',end_value,
  'can_manage',public.has_permission('payroll.manage'),'can_reopen',public.has_permission('payroll.reopen'),
  'settings',jsonb_build_object('monthly_divisor',coalesce(settings.monthly_divisor,30),'deduct_absence',coalesce(settings.deduct_absence,true),'deduct_unpaid_leave',coalesce(settings.deduct_unpaid_leave,true),'deduct_late_minutes',coalesce(settings.deduct_late_minutes,false),'deduct_early_leave_minutes',coalesce(settings.deduct_early_leave_minutes,false),'overtime_enabled',coalesce(settings.overtime_enabled,true)),
  'cycle',case when cycle.id is null then null else jsonb_build_object('id',cycle.id,'period_start',cycle.period_start,'period_end',cycle.period_end,'label',cycle.label,'status',cycle.status,'calculated_at',cycle.calculated_at,'reviewed_at',cycle.reviewed_at,'closed_at',cycle.closed_at,'notes',cycle.notes) end,
  'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code) order by b.name),'[]'::jsonb) from public.branches b where b.company_id=c and b.is_active),
  'items',case when cycle.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
   'id',i.id,'employee_id',i.employee_id,'employee_code',i.employee_code_snapshot,'employee_name',i.employee_name_snapshot,'branch_id',i.branch_id,'branch_name',b.name,
   'salary_type',i.salary_type_snapshot,'base_salary',i.base_salary_snapshot,'day_rate',i.day_rate_snapshot,'scheduled_work_days',i.scheduled_work_days,'present_days',i.present_days,'paid_leave_days',i.paid_leave_days,'unpaid_leave_days',i.unpaid_leave_days,'absent_days',i.absent_days,
   'worked_minutes',i.worked_minutes,'late_minutes',i.late_minutes,'early_leave_minutes',i.early_leave_minutes,'overtime_minutes',i.overtime_minutes,
   'gross_base',i.gross_base,'overtime_amount',i.overtime_amount,'manual_earnings',i.manual_earnings,'absence_deduction',i.absence_deduction,'unpaid_leave_deduction',i.unpaid_leave_deduction,'late_deduction',i.late_deduction,'early_leave_deduction',i.early_leave_deduction,'penalty_deduction',i.penalty_deduction,'manual_deductions',i.manual_deductions,'gross_earnings',i.gross_earnings,'total_deductions',i.total_deductions,'net_salary',i.net_salary,'adjustment_notes',i.adjustment_notes) order by i.employee_name_snapshot)
   from public.payroll_items i left join public.branches b on b.id=i.branch_id and b.company_id=c where i.cycle_id=cycle.id and i.company_id=c),'[]'::jsonb) end);
end; $$;
revoke all on function public.app_payroll_workspace(date) from public,anon;
grant execute on function public.app_payroll_workspace(date) to authenticated;

create function public.app_calculate_payroll(p_month date) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
 c uuid:=app_private.require_company_permission('payroll.manage'); actor uuid:=public.current_employee_id(); tz text; v_period_start date; v_period_end date; calc_end date; v_cycle_id uuid; cycle_row public.payroll_cycles; settings public.payroll_settings; emp public.employees;
 scheduled numeric; present numeric; off_days numeric; mission_days numeric; paid_leave numeric; unpaid_leave numeric; absent numeric;
 worked integer; late integer; early integer; overtime integer; regular_minutes integer; day_rate numeric; hour_rate numeric; gross_base numeric; overtime_amount numeric; absence_deduction numeric; unpaid_deduction numeric; late_deduction numeric; early_deduction numeric; penalty_deduction numeric; manual_earn numeric; manual_deduct numeric; gross numeric; total_deduct numeric; net numeric; old_item public.payroll_items;
begin
 if actor is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 v_period_start:=date_trunc('month',coalesce(p_month,current_date))::date; v_period_end:=(v_period_start+interval '1 month - 1 day')::date;
 select coalesce(timezone,'Africa/Cairo') into tz from public.companies where id=c; calc_end:=least(v_period_end,(clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date);
 if v_period_start>calc_end then raise exception 'future payroll month cannot be calculated' using errcode='22023'; end if;
 insert into public.payroll_settings(company_id) values(c) on conflict(company_id) do nothing;
 select * into settings from public.payroll_settings where company_id=c;
 select pc.* into cycle_row from public.payroll_cycles pc where pc.company_id=c and pc.period_start=v_period_start and pc.period_end=v_period_end for update;
 if found and cycle_row.status='closed' then raise exception 'closed payroll cycle must be reopened before recalculation' using errcode='P0001'; end if;
 if cycle_row.id is null then
  insert into public.payroll_cycles(company_id,period_start,period_end,label,status,created_by,calculated_by,calculated_at)
  values(c,v_period_start,v_period_end,to_char(v_period_start,'YYYY-MM'),'draft',actor,actor,clock_timestamp()) returning id into v_cycle_id;
 else
  v_cycle_id:=cycle_row.id; update public.payroll_cycles set status='draft',calculated_by=actor,calculated_at=clock_timestamp(),reviewed_by=null,reviewed_at=null,updated_at=clock_timestamp() where id=v_cycle_id and company_id=c;
 end if;
 for emp in select e.* from public.employees e where e.company_id=c and e.employment_status<>'terminated' and e.deleted_at is null and (e.hire_date is null or e.hire_date<=calc_end) order by e.full_name loop
  select count(*) filter(where sa.day_type='work'),count(*) filter(where sa.day_type='work' and a.check_in_at is not null and a.check_out_at is not null and a.attendance_status in ('present','late','early_leave','corrected')),
   count(*) filter(where sa.day_type='off'),count(*) filter(where sa.day_type='mission'),
   coalesce(sum(case when lr.status='approved' and lt.is_paid then 1 else 0 end),0),coalesce(sum(case when lr.status='approved' and not lt.is_paid then 1 else 0 end),0),
   coalesce(sum(case when a.check_in_at is not null and a.check_out_at is not null and a.attendance_status in ('present','late','early_leave','corrected') then coalesce(a.worked_minutes,0) else 0 end),0)::integer,
   coalesce(sum(case when a.check_in_at is not null then coalesce(a.late_minutes,0) else 0 end),0)::integer,coalesce(sum(coalesce(a.early_leave_minutes,0)),0)::integer,
   coalesce(sum(case when a.check_in_at is not null and a.check_out_at is not null and sa.planned_start is not null and sa.planned_end is not null then greatest(coalesce(a.worked_minutes,0)-greatest(floor(extract(epoch from (((sa.shift_date+sa.planned_end)+case when sa.planned_end<sa.planned_start then interval '1 day' else interval '0' end)-(sa.shift_date+sa.planned_start)))/60)::integer-coalesce(st.break_minutes,0),0),0) else 0 end),0)::integer
  into scheduled,present,off_days,mission_days,paid_leave,unpaid_leave,worked,late,early,overtime
  from public.shift_assignments sa left join public.attendance_sessions a on a.company_id=c and a.employee_id=emp.id and (a.shift_assignment_id=sa.id or (a.shift_assignment_id is null and a.work_date=sa.shift_date))
  left join public.shift_templates st on st.id=sa.shift_template_id and st.company_id=c
  left join public.leave_requests lr on lr.company_id=c and lr.employee_id=emp.id and lr.status='approved' and sa.shift_date between lr.starts_on and lr.ends_on
  left join public.leave_types lt on lt.id=lr.leave_type_id and lt.company_id=c
  where sa.company_id=c and sa.employee_id=emp.id and sa.shift_date between v_period_start and calc_end and sa.status='published';
  regular_minutes:=greatest(worked-overtime,0); paid_leave:=least(paid_leave,scheduled); unpaid_leave:=least(unpaid_leave,greatest(scheduled-paid_leave,0)); absent:=greatest(scheduled-present-paid_leave-unpaid_leave,0);
  day_rate:=case emp.salary_type when 'monthly' then coalesce(emp.base_salary,0)/greatest(coalesce(settings.monthly_divisor,30),1) when 'daily' then coalesce(emp.base_salary,0) when 'hourly' then coalesce(emp.base_salary,0)*coalesce(emp.default_daily_hours,9) else 0 end;
  hour_rate:=case when emp.salary_type='monthly' then day_rate/greatest(coalesce(emp.default_daily_hours,9),1) else coalesce(emp.overtime_hour_rate,0) end;
  if emp.salary_type='monthly' then gross_base:=round(((regular_minutes::numeric/60)+((off_days+mission_days+paid_leave)*coalesce(emp.default_daily_hours,9)))*hour_rate,2);
  elsif emp.salary_type='daily' then gross_base:=round((present+paid_leave+mission_days)*day_rate,2);
  elsif emp.salary_type='hourly' then gross_base:=round((regular_minutes::numeric/60)*coalesce(emp.base_salary,0),2);
  else gross_base:=0; end if;
  overtime_amount:=case when coalesce(settings.overtime_enabled,true) then round((overtime::numeric/60)*case when emp.salary_type='monthly' then hour_rate*coalesce(settings.overtime_multiplier,1.5) else coalesce(emp.overtime_hour_rate,0) end,2) else 0 end;
  absence_deduction:=case when coalesce(settings.deduct_absence,true) then round(absent*day_rate,2) else 0 end;
  unpaid_deduction:=case when coalesce(settings.deduct_unpaid_leave,true) then round(unpaid_leave*day_rate,2) else 0 end;
  late_deduction:=case when coalesce(settings.deduct_late_minutes,false) then round((late::numeric/60)*hour_rate,2) else 0 end;
  early_deduction:=case when coalesce(settings.deduct_early_leave_minutes,false) then round((early::numeric/60)*hour_rate,2) else 0 end;
  select coalesce(sum(ep.amount+ep.deduction_days*day_rate),0) into penalty_deduction from public.employee_penalties ep where ep.company_id=c and ep.employee_id=emp.id and ep.status='approved' and ep.effective_date between v_period_start and calc_end;
  select i.* into old_item from public.payroll_items i where i.company_id=c and i.cycle_id=v_cycle_id and i.employee_id=emp.id;
  manual_earn:=coalesce(old_item.manual_earnings,0); manual_deduct:=coalesce(old_item.manual_deductions,0);
  gross:=round(gross_base+overtime_amount+manual_earn,2); total_deduct:=round(absence_deduction+unpaid_deduction+late_deduction+early_deduction+penalty_deduction+manual_deduct,2); net:=greatest(round(gross-total_deduct,2),0);
  insert into public.payroll_items(company_id,cycle_id,employee_id,branch_id,employee_code_snapshot,employee_name_snapshot,salary_type_snapshot,overtime_hour_rate_snapshot,default_daily_hours_snapshot,base_salary_snapshot,day_rate_snapshot,scheduled_work_days,present_days,paid_leave_days,unpaid_leave_days,absent_days,worked_minutes,late_minutes,early_leave_minutes,overtime_minutes,gross_base,gross_earnings,overtime_amount,absence_deduction,late_deduction,early_leave_deduction,unpaid_leave_deduction,penalty_deduction,manual_earnings,manual_deductions,total_deductions,net_salary,adjustment_notes,updated_at)
  values(c,v_cycle_id,emp.id,emp.branch_id,emp.employee_code,emp.full_name,emp.salary_type,emp.overtime_hour_rate,emp.default_daily_hours,emp.base_salary,day_rate,scheduled,present,paid_leave,unpaid_leave,absent,worked,late,early,overtime,gross_base,gross,overtime_amount,absence_deduction,late_deduction,early_deduction,unpaid_deduction,penalty_deduction,manual_earn,manual_deduct,total_deduct,net,old_item.adjustment_notes,clock_timestamp())
  on conflict(cycle_id,employee_id) do update set branch_id=excluded.branch_id,employee_code_snapshot=excluded.employee_code_snapshot,employee_name_snapshot=excluded.employee_name_snapshot,salary_type_snapshot=excluded.salary_type_snapshot,overtime_hour_rate_snapshot=excluded.overtime_hour_rate_snapshot,default_daily_hours_snapshot=excluded.default_daily_hours_snapshot,base_salary_snapshot=excluded.base_salary_snapshot,day_rate_snapshot=excluded.day_rate_snapshot,scheduled_work_days=excluded.scheduled_work_days,present_days=excluded.present_days,paid_leave_days=excluded.paid_leave_days,unpaid_leave_days=excluded.unpaid_leave_days,absent_days=excluded.absent_days,worked_minutes=excluded.worked_minutes,late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,overtime_minutes=excluded.overtime_minutes,gross_base=excluded.gross_base,gross_earnings=excluded.gross_earnings,overtime_amount=excluded.overtime_amount,absence_deduction=excluded.absence_deduction,late_deduction=excluded.late_deduction,early_leave_deduction=excluded.early_leave_deduction,unpaid_leave_deduction=excluded.unpaid_leave_deduction,penalty_deduction=excluded.penalty_deduction,total_deductions=excluded.total_deductions,net_salary=excluded.net_salary,adjustment_notes=excluded.adjustment_notes,updated_at=clock_timestamp();
 end loop;
 delete from public.payroll_items i where i.company_id=c and i.cycle_id=v_cycle_id and not exists(select 1 from public.employees e where e.id=i.employee_id and e.company_id=c and e.employment_status<>'terminated' and e.deleted_at is null and (e.hire_date is null or e.hire_date<=calc_end));
 perform app_private.audit_company_action(c,'payroll.calculated','payroll_cycle',v_cycle_id,null,jsonb_build_object('period_start',v_period_start,'period_end',v_period_end,'calculated_through',calc_end));
 return v_cycle_id;
end; $$;
revoke all on function public.app_calculate_payroll(date) from public,anon;
grant execute on function public.app_calculate_payroll(date) to authenticated;

create function public.app_review_payroll_cycle(p_cycle_id uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('payroll.manage'); actor uuid:=public.current_employee_id();
begin
 if not exists(select 1 from public.payroll_items where company_id=c and cycle_id=p_cycle_id) then raise exception 'calculate payroll before review' using errcode='P0001'; end if;
 update public.payroll_cycles set status='reviewed',reviewed_by=actor,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_cycle_id and company_id=c and status='draft';
 if not found then raise exception 'payroll cycle is unavailable for review' using errcode='P0001'; end if;
 perform app_private.audit_company_action(c,'payroll.reviewed','payroll_cycle',p_cycle_id,null,jsonb_build_object('status','reviewed'));
end; $$;
revoke all on function public.app_review_payroll_cycle(uuid) from public,anon;
grant execute on function public.app_review_payroll_cycle(uuid) to authenticated;

create function public.app_close_payroll_cycle(p_cycle_id uuid) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('payroll.manage'); actor uuid:=public.current_employee_id();
begin
 update public.payroll_cycles set status='closed',closed_by=actor,closed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_cycle_id and company_id=c and status='reviewed';
 if not found then raise exception 'payroll cycle must be reviewed before closing' using errcode='P0001'; end if;
 perform app_private.audit_company_action(c,'payroll.closed','payroll_cycle',p_cycle_id,null,jsonb_build_object('status','closed'));
end; $$;
revoke all on function public.app_close_payroll_cycle(uuid) from public,anon;
grant execute on function public.app_close_payroll_cycle(uuid) to authenticated;

create function public.app_reopen_payroll_cycle(p_cycle_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('payroll.reopen'); actor uuid:=public.current_employee_id(); reason_value text:=nullif(btrim(p_reason),''); cycle public.payroll_cycles;
begin
 if reason_value is null or char_length(reason_value)<5 then raise exception 'reopening requires a reason of at least five characters' using errcode='22023'; end if;
 select * into cycle from public.payroll_cycles where id=p_cycle_id and company_id=c and status='closed' for update;
 if not found then raise exception 'closed payroll cycle not found' using errcode='P0002'; end if;
 update public.payroll_cycles set status='draft',reopened_by=actor,reopened_at=clock_timestamp(),reviewed_by=null,reviewed_at=null,closed_by=null,closed_at=null,notes=concat_ws(E'\n',nullif(notes,''),'Reopened: '||reason_value),updated_at=clock_timestamp() where id=cycle.id and company_id=c;
 perform app_private.audit_company_action(c,'payroll.reopened','payroll_cycle',cycle.id,to_jsonb(cycle),jsonb_build_object('status','draft','reason',reason_value));
end; $$;
revoke all on function public.app_reopen_payroll_cycle(uuid,text) from public,anon;
grant execute on function public.app_reopen_payroll_cycle(uuid,text) to authenticated;

create function public.app_adjust_payroll_item(p_item_id uuid,p_manual_earnings numeric,p_manual_deductions numeric,p_notes text) returns void
language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('payroll.manage'); item public.payroll_items; cycle public.payroll_cycles; earn numeric:=greatest(coalesce(p_manual_earnings,0),0); deduct numeric:=greatest(coalesce(p_manual_deductions,0),0);
begin
 if p_manual_earnings<0 or p_manual_deductions<0 then raise exception 'manual payroll adjustments cannot be negative' using errcode='22023'; end if;
 select * into item from public.payroll_items where id=p_item_id and company_id=c for update;
 if not found then raise exception 'payroll item not found' using errcode='P0002'; end if;
 select * into cycle from public.payroll_cycles where id=item.cycle_id and company_id=c for update;
 if not found or cycle.status='closed' then raise exception 'closed or missing payroll cycle cannot be adjusted' using errcode='P0001'; end if;
 update public.payroll_items set manual_earnings=earn,manual_deductions=deduct,adjustment_notes=nullif(btrim(p_notes),''),gross_earnings=round(gross_base+overtime_amount+earn,2),total_deductions=round(absence_deduction+unpaid_leave_deduction+late_deduction+early_leave_deduction+penalty_deduction+deduct,2),net_salary=greatest(round(gross_base+overtime_amount+earn-absence_deduction-unpaid_leave_deduction-late_deduction-early_leave_deduction-penalty_deduction-deduct,2),0),updated_at=clock_timestamp() where id=item.id and company_id=c;
 if cycle.status='reviewed' then update public.payroll_cycles set status='draft',reviewed_by=null,reviewed_at=null,updated_at=clock_timestamp() where id=cycle.id and company_id=c; end if;
 perform app_private.audit_company_action(c,'payroll.item_adjusted','payroll_item',item.id,to_jsonb(item),jsonb_build_object('manual_earnings',earn,'manual_deductions',deduct,'notes',p_notes));
end; $$;
revoke all on function public.app_adjust_payroll_item(uuid,numeric,numeric,text) from public,anon;
grant execute on function public.app_adjust_payroll_item(uuid,numeric,numeric,text) to authenticated;
