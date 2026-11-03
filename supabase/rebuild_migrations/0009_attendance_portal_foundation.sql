-- Attendance and employee portal contracts used by /portal and attendance admin.

create unique index attendance_one_open_employee_uidx
 on public.attendance_sessions(employee_id) where check_out_at is null and attendance_status='open';

create function app_private.is_company_owner_employee(p_company_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.employee_roles er join public.roles r on r.id=er.role_id
  where er.employee_id=p_employee_id and r.company_id=p_company_id and r.code='COMPANY_OWNER' and r.is_active);
$$;
revoke all on function app_private.is_company_owner_employee(uuid,uuid) from public,anon,authenticated;

create function public.app_attendance_action(
 p_action text,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision,p_device_id text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 employee_id_value uuid:=public.current_employee_id(); company_id_value uuid:=public.current_company_id();
 timezone_name text; now_value timestamptz:=clock_timestamp(); local_date date; action_value text:=lower(btrim(coalesce(p_action,'')));
 shift_row public.shift_assignments; session_row public.attendance_sessions; branch_row public.branches;
 point_value extensions.geography(point,4326); distance_value double precision; grace_value integer:=0;
 late_value integer:=0; early_value integer:=0; worked_value integer:=0;
 start_at timestamptz; end_at timestamptz; status_value text;
begin
 if employee_id_value is null or company_id_value is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 if p_latitude is null or p_longitude is null or p_accuracy_m is null or p_latitude not between -90 and 90
   or p_longitude not between -180 and 180 or p_accuracy_m<0 or p_accuracy_m='NaN'::double precision then
  raise exception 'valid device location and accuracy are required' using errcode='22023';
 end if;
 if action_value not in ('check_in','check_out') then raise exception 'unsupported attendance action' using errcode='22023'; end if;
 select coalesce(c.timezone,'Africa/Cairo') into timezone_name from public.companies c where c.id=company_id_value;
 local_date:=(now_value at time zone coalesce(timezone_name,'Africa/Cairo'))::date;
 point_value:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography;

 if action_value='check_in' then
  if exists(select 1 from public.attendance_sessions a where a.company_id=company_id_value and a.employee_id=employee_id_value and a.check_out_at is null and a.attendance_status='open') then
   raise exception 'an open attendance session already exists' using errcode='23505';
  end if;
  select sa.* into shift_row from public.shift_assignments sa
   where sa.company_id=company_id_value and sa.employee_id=employee_id_value and sa.shift_date=local_date
    and sa.status='published' and sa.day_type='work' order by sa.planned_start limit 1;
  if not found then raise exception 'no published work shift is assigned for today' using errcode='P0001'; end if;
  if shift_row.planned_start is null or shift_row.planned_end is null then raise exception 'published work shift has incomplete times' using errcode='P0001'; end if;
  start_at:=(local_date+shift_row.planned_start) at time zone coalesce(timezone_name,'Africa/Cairo');
  end_at:=((local_date+case when shift_row.planned_end<shift_row.planned_start then 1 else 0 end)+shift_row.planned_end) at time zone coalesce(timezone_name,'Africa/Cairo');
  if now_value<start_at-interval '4 hours' then raise exception 'attendance window has not opened' using errcode='P0001'; end if;
  if now_value>end_at+interval '4 hours' then raise exception 'attendance window has closed' using errcode='P0001'; end if;
  select b.* into branch_row from public.branches b where b.id=shift_row.branch_id and b.company_id=company_id_value and b.is_active;
  if not found or branch_row.location is null then raise exception 'assigned branch has no active attendance location' using errcode='P0001'; end if;
  if p_accuracy_m>branch_row.minimum_gps_accuracy_m then raise exception 'GPS accuracy exceeds the branch limit' using errcode='P0001'; end if;
  distance_value:=extensions.st_distance(branch_row.location,point_value);
  if distance_value>branch_row.attendance_radius_m then raise exception 'device is outside the branch attendance radius' using errcode='P0001'; end if;
  select coalesce(st.grace_minutes,0) into grace_value from public.shift_templates st where st.id=shift_row.shift_template_id and st.company_id=company_id_value;
  late_value:=greatest(floor(extract(epoch from (now_value-(start_at+make_interval(mins=>coalesce(grace_value,0)))))/60)::integer,0);
  insert into public.attendance_sessions(company_id,employee_id,branch_id,shift_assignment_id,work_date,check_in_at,
    check_in_location,check_in_accuracy_m,check_in_distance_m,check_in_device_id,source,attendance_status,late_minutes)
  values(company_id_value,employee_id_value,branch_row.id,shift_row.id,local_date,now_value,point_value,p_accuracy_m,distance_value,
    nullif(btrim(p_device_id),''),case when p_device_id ilike 'ios:%' then 'ios' else 'web' end,'open',late_value)
  returning * into session_row;
  insert into public.geofence_events(company_id,employee_id,branch_id,attendance_session_id,event_type,action,location,accuracy_m,device_id,accepted)
   values(company_id_value,employee_id_value,branch_row.id,session_row.id,'check_in','check_in',point_value,p_accuracy_m,nullif(btrim(p_device_id),''),true);
  perform app_private.audit_company_action(company_id_value,'attendance.check_in','attendance_session',session_row.id,null,
   jsonb_build_object('branch_id',branch_row.id,'work_date',local_date,'late_minutes',late_value,'distance_m',round(distance_value::numeric,2),'accuracy_m',round(p_accuracy_m::numeric,2)),
   jsonb_build_object('source','app_attendance_action'));
  return jsonb_build_object('ok',true,'action','check_in','session_id',session_row.id,'server_time',now_value,
    'distance_m',round(distance_value),'accuracy_m',round(p_accuracy_m),'late_minutes',late_value,
    'message',case when late_value>0 then format('تم تسجيل الحضور مع تأخير %s دقيقة.',late_value) else 'تم تسجيل الحضور بنجاح.' end);
 end if;

 select a.* into session_row from public.attendance_sessions a where a.company_id=company_id_value and a.employee_id=employee_id_value
  and a.check_out_at is null and a.attendance_status='open' order by a.check_in_at desc limit 1 for update;
 if not found then raise exception 'there is no open attendance session to check out' using errcode='P0001'; end if;
 select b.* into branch_row from public.branches b where b.id=session_row.branch_id and b.company_id=company_id_value;
 if not found or branch_row.location is null then raise exception 'attendance branch location is unavailable' using errcode='P0001'; end if;
 if p_accuracy_m>branch_row.minimum_gps_accuracy_m then raise exception 'GPS accuracy exceeds the branch limit' using errcode='P0001'; end if;
 distance_value:=extensions.st_distance(branch_row.location,point_value);
 if distance_value>branch_row.attendance_radius_m then raise exception 'device is outside the branch attendance radius' using errcode='P0001'; end if;
 select sa.* into shift_row from public.shift_assignments sa where sa.id=session_row.shift_assignment_id and sa.company_id=company_id_value;
 if found and shift_row.planned_end is not null then
  end_at:=((session_row.work_date+case when shift_row.planned_start is not null and shift_row.planned_end<shift_row.planned_start then 1 else 0 end)+shift_row.planned_end) at time zone coalesce(timezone_name,'Africa/Cairo');
  early_value:=greatest(floor(extract(epoch from (end_at-now_value))/60)::integer,0);
 end if;
 worked_value:=greatest(floor(extract(epoch from (now_value-session_row.check_in_at))/60)::integer,0);
 status_value:=case when early_value>0 then 'early_leave' when session_row.late_minutes>0 then 'late' else 'present' end;
 update public.attendance_sessions set check_out_at=now_value,check_out_location=point_value,check_out_accuracy_m=p_accuracy_m,
  check_out_distance_m=distance_value,check_out_device_id=nullif(btrim(p_device_id),''),early_leave_minutes=early_value,
  worked_minutes=worked_value,attendance_status=status_value,updated_at=clock_timestamp()
 where id=session_row.id and company_id=company_id_value returning * into session_row;
 insert into public.geofence_events(company_id,employee_id,branch_id,attendance_session_id,event_type,action,location,accuracy_m,device_id,accepted)
  values(company_id_value,employee_id_value,branch_row.id,session_row.id,'check_out','check_out',point_value,p_accuracy_m,nullif(btrim(p_device_id),''),true);
 perform app_private.audit_company_action(company_id_value,'attendance.check_out','attendance_session',session_row.id,null,
  jsonb_build_object('branch_id',branch_row.id,'work_date',session_row.work_date,'worked_minutes',worked_value,'early_leave_minutes',early_value,'status',status_value,'distance_m',round(distance_value::numeric,2),'accuracy_m',round(p_accuracy_m::numeric,2)),
  jsonb_build_object('source','app_attendance_action'));
 return jsonb_build_object('ok',true,'action','check_out','session_id',session_row.id,'server_time',now_value,
  'distance_m',round(distance_value),'accuracy_m',round(p_accuracy_m),'worked_minutes',worked_value,
  'early_leave_minutes',early_value,'status',status_value,'message',case when early_value>0 then format('تم تسجيل الانصراف مبكرًا بـ %s دقيقة.',early_value) else 'تم تسجيل الانصراف بنجاح.' end);
end; $$;
revoke all on function public.app_attendance_action(text,double precision,double precision,double precision,text) from public,anon;
grant execute on function public.app_attendance_action(text,double precision,double precision,double precision,text) to authenticated;

create function public.app_my_web_attendance_access() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare e uuid:=public.current_employee_id(); c uuid:=public.current_company_id();
begin
 return jsonb_build_object('allowed',e is not null and exists(select 1 from public.web_attendance_exceptions w where w.employee_id=e and w.company_id=c and w.enabled));
end; $$;
revoke all on function public.app_my_web_attendance_access() from public,anon;
grant execute on function public.app_my_web_attendance_access() to authenticated;

create function public.app_report_attendance_position(p_latitude double precision,p_longitude double precision,p_accuracy_m double precision)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare e uuid:=public.current_employee_id(); c uuid:=public.current_company_id(); session_row public.attendance_sessions;
 b public.branches; point_value extensions.geography(point,4326); distance_value double precision; accuracy_ok boolean; in_range boolean;
begin
 if e is null or c is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 if p_latitude is null or p_longitude is null or p_accuracy_m is null or p_latitude not between -90 and 90
   or p_longitude not between -180 and 180 or p_accuracy_m<0 or p_accuracy_m='NaN'::double precision then
  raise exception 'valid device location and accuracy are required' using errcode='22023';
 end if;
 select a.* into session_row from public.attendance_sessions a where a.company_id=c and a.employee_id=e and a.check_out_at is null and a.attendance_status='open'
  order by a.check_in_at desc limit 1;
 if not found then raise exception 'no open attendance session' using errcode='P0001'; end if;
 select x.* into b from public.branches x where x.id=session_row.branch_id and x.company_id=c and x.is_active;
 if not found or b.location is null then raise exception 'attendance branch location is unavailable' using errcode='P0001'; end if;
 point_value:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography;
 distance_value:=extensions.st_distance(b.location,point_value);
 accuracy_ok:=p_accuracy_m<=b.minimum_gps_accuracy_m;
 in_range:=distance_value<=b.attendance_radius_m;
 insert into public.geofence_events(company_id,employee_id,branch_id,attendance_session_id,event_type,action,location,accuracy_m,accepted,rejection_reason)
  values(c,e,b.id,session_row.id,case when in_range then 'position_in_range' else 'position_out_of_range' end,'position',point_value,p_accuracy_m,
   accuracy_ok and in_range,case when not accuracy_ok then 'gps_accuracy_limit' when not in_range then 'outside_attendance_radius' else null end);
 return jsonb_build_object('in_range',in_range,'accuracy_ok',accuracy_ok,'distance_m',round(distance_value),'accuracy_m',round(p_accuracy_m),'radius_m',b.attendance_radius_m);
end; $$;
revoke all on function public.app_report_attendance_position(double precision,double precision,double precision) from public,anon;
grant execute on function public.app_report_attendance_position(double precision,double precision,double precision) to authenticated;

create function public.app_my_portal(p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
 e uuid:=public.current_employee_id(); c uuid:=public.current_company_id(); tz text; today_value date; week_value date;
 profile_value jsonb; shifts_value jsonb; attendance_value jsonb; today_shift_value jsonb; open_value jsonb;
 leave_types_value jsonb; leave_requests_value jsonb; leave_balances_value jsonb; penalties_value jsonb; notifications_value jsonb;
begin
 if e is null or c is null then raise exception 'active employee membership required' using errcode='42501'; end if;
 select coalesce(co.timezone,'Africa/Cairo') into tz from public.companies co where co.id=c;
 tz:=coalesce(tz,'Africa/Cairo'); today_value:=(clock_timestamp() at time zone tz)::date;
 week_value:=coalesce(p_week_start,(date_trunc('week',today_value::timestamp))::date);
 select jsonb_build_object('employee_code',emp.employee_code,'full_name',emp.full_name,'branch_name',b.name,
  'attendance_radius_m',b.attendance_radius_m,'minimum_gps_accuracy_m',b.minimum_gps_accuracy_m,'job_title_name',j.name,
  'manager_name',manager.full_name,'salary_type',emp.salary_type,'base_salary',emp.base_salary)
 into profile_value from public.employees emp left join public.branches b on b.id=emp.branch_id and b.company_id=c
  left join public.job_titles j on j.id=emp.job_title_id and j.company_id=c
  left join public.employees manager on manager.id=emp.direct_manager_id and manager.company_id=c
 where emp.id=e and emp.company_id=c;
 select coalesce(jsonb_agg(jsonb_build_object('id',sa.id,'shift_date',sa.shift_date,'day_type',sa.day_type,
  'start_time',case when sa.planned_start is null then null else to_char(sa.planned_start,'HH24:MI') end,
  'end_time',case when sa.planned_end is null then null else to_char(sa.planned_end,'HH24:MI') end,
  'status',sa.status,'branch_name',b.name,'notes',sa.notes) order by sa.shift_date),'[]'::jsonb)
 into shifts_value from public.shift_assignments sa left join public.branches b on b.id=sa.branch_id and b.company_id=c
 where sa.company_id=c and sa.employee_id=e and sa.shift_date between week_value and week_value+6 and sa.status='published';
 select jsonb_build_object('id',sa.id,'shift_date',sa.shift_date,'day_type',sa.day_type,
  'start_time',to_char(sa.planned_start,'HH24:MI'),'end_time',to_char(sa.planned_end,'HH24:MI'),
  'branch_id',sa.branch_id,'branch_name',b.name,'status',sa.status)
 into today_shift_value from public.shift_assignments sa left join public.branches b on b.id=sa.branch_id and b.company_id=c
 where sa.company_id=c and sa.employee_id=e and sa.shift_date=today_value and sa.status='published' order by sa.planned_start limit 1;
 select jsonb_build_object('id',a.id,'check_in_at',to_char(a.check_in_at at time zone tz,'YYYY-MM-DD HH24:MI'),
  'late_minutes',a.late_minutes,'branch_id',a.branch_id,'branch_name',b.name)
 into open_value from public.attendance_sessions a left join public.branches b on b.id=a.branch_id and b.company_id=c
 where a.company_id=c and a.employee_id=e and a.check_out_at is null and a.attendance_status='open' order by a.check_in_at desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'date',(coalesce(a.check_in_at,a.created_at) at time zone tz)::date,
  'check_in',case when a.check_in_at is null then null else to_char(a.check_in_at at time zone tz,'YYYY-MM-DD HH24:MI') end,
  'check_out',case when a.check_out_at is null then null else to_char(a.check_out_at at time zone tz,'YYYY-MM-DD HH24:MI') end,
  'status',a.attendance_status,'late_minutes',a.late_minutes,'early_leave_minutes',a.early_leave_minutes,
  'worked_minutes',a.worked_minutes,'branch_name',b.name) order by coalesce(a.check_in_at,a.created_at) desc),'[]'::jsonb)
 into attendance_value from (select * from public.attendance_sessions where company_id=c and employee_id=e order by coalesce(check_in_at,created_at) desc limit 30) a
 left join public.branches b on b.id=a.branch_id and b.company_id=c;
 select coalesce(jsonb_agg(jsonb_build_object('id',lt.id,'name',lt.name,'code',lt.code,'annual_entitlement',lt.annual_entitlement,
  'is_paid',lt.is_paid,'requires_attachment',lt.requires_attachment) order by lt.name),'[]'::jsonb)
 into leave_types_value from public.leave_types lt where lt.company_id=c and lt.is_active;
 select coalesce(jsonb_agg(jsonb_build_object('id',lr.id,'leave_type_name',lt.name,'starts_on',lr.starts_on,'ends_on',lr.ends_on,
  'requested_days',lr.requested_days,'reason',lr.reason,'status',lr.status,'reviewer_notes',lr.reviewer_notes,'created_at',lr.created_at) order by lr.created_at desc),'[]'::jsonb)
 into leave_requests_value from public.leave_requests lr join public.leave_types lt on lt.id=lr.leave_type_id and lt.company_id=c where lr.company_id=c and lr.employee_id=e;
 select coalesce(jsonb_agg(jsonb_build_object('leave_type_id',lt.id,'name',lt.name,'entitlement',lt.annual_entitlement,
  'used',coalesce(used.total,0),'remaining',greatest(lt.annual_entitlement-coalesce(used.total,0),0)) order by lt.name),'[]'::jsonb)
 into leave_balances_value from public.leave_types lt left join (
  select lr.leave_type_id,sum(lr.requested_days) total from public.leave_requests lr where lr.company_id=c and lr.employee_id=e
   and lr.status='approved' and extract(year from lr.starts_on)=extract(year from today_value) group by lr.leave_type_id
 ) used on used.leave_type_id=lt.id where lt.company_id=c and lt.is_active and coalesce(lt.annual_entitlement,0)>0;
 select coalesce(jsonb_agg(jsonb_build_object('id',ep.id,'penalty_type',ep.penalty_type,'title',ep.title,'reason',ep.reason,
  'amount',ep.amount,'deduction_days',ep.deduction_days,'effective_date',ep.effective_date,'status',ep.status,'created_at',ep.created_at) order by ep.effective_date desc),'[]'::jsonb)
 into penalties_value from public.employee_penalties ep where ep.company_id=c and ep.employee_id=e and ep.status='approved';
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'type',n.notification_type,'title',n.title,'body',n.body,
  'read_at',n.read_at,'created_at',n.created_at) order by n.created_at desc),'[]'::jsonb)
 into notifications_value from (select * from public.notifications where company_id=c and recipient_employee_id=e order by created_at desc limit 20) n;
 return jsonb_build_object('profile',profile_value,'today',today_value,'week_start',week_value,'today_shift',today_shift_value,
  'open_session',open_value,'shifts',shifts_value,'attendance',attendance_value,'leave_types',leave_types_value,
  'leave_requests',leave_requests_value,'leave_balances',leave_balances_value,'penalties',penalties_value,'notifications',notifications_value);
end; $$;
revoke all on function public.app_my_portal(date) from public,anon;
grant execute on function public.app_my_portal(date) to authenticated;

create function public.app_attendance_admin_options() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id();
begin
 if c is null or not (public.has_permission('attendance.review') or public.has_permission('attendance.monitor') or public.has_permission('attendance.adjust')) then
  raise exception 'attendance review permission required' using errcode='42501';
 end if;
 return jsonb_build_object('can_adjust',public.has_permission('attendance.adjust'),
  'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code) order by b.name) from public.branches b where b.company_id=c and b.is_active),'[]'::jsonb),
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'employee_code',e.employee_code,'full_name',e.full_name,'branch_id',e.branch_id,'branch_name',b.name) order by e.full_name)
    from public.employees e left join public.branches b on b.id=e.branch_id and b.company_id=e.company_id where e.company_id=c and e.employment_status='active' and e.deleted_at is null),'[]'::jsonb));
end; $$;
revoke all on function public.app_attendance_admin_options() from public,anon;
grant execute on function public.app_attendance_admin_options() to authenticated;

create function public.app_attendance_admin_report(p_date_from date,p_date_to date,p_branch_id uuid default null)
returns table(session_id uuid,shift_assignment_id uuid,shift_date date,employee_id uuid,employee_code text,employee_name text,
 branch_id uuid,branch_name text,region_name text,day_type text,planned_start text,planned_end text,check_in text,check_out text,
 attendance_status text,late_minutes integer,original_late_minutes integer,early_leave_minutes integer,worked_minutes integer,
 source text,is_adjusted boolean,adjustment_reason text,adjusted_by_name text,adjusted_at text)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=public.current_company_id(); tz text;
begin
 if c is null or not (public.has_permission('attendance.review') or public.has_permission('attendance.monitor') or public.has_permission('attendance.adjust')) then
  raise exception 'attendance review permission required' using errcode='42501';
 end if;
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>366 then raise exception 'invalid attendance report date range' using errcode='22023'; end if;
 if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside current company' using errcode='42501'; end if;
 select coalesce(co.timezone,'Africa/Cairo') into tz from public.companies co where co.id=c;
 return query
 select a.id,sa.id,sa.shift_date,e.id,e.employee_code,e.full_name,b.id,b.name,r.name,sa.day_type,
  case when sa.planned_start is null then null else to_char(sa.planned_start,'HH24:MI') end,
  case when sa.planned_end is null then null else to_char(sa.planned_end,'HH24:MI') end,
  case when a.check_in_at is null then null else to_char(a.check_in_at at time zone coalesce(tz,'Africa/Cairo'),'YYYY-MM-DD HH24:MI') end,
  case when a.check_out_at is null then null else to_char(a.check_out_at at time zone coalesce(tz,'Africa/Cairo'),'YYYY-MM-DD HH24:MI') end,
  coalesce(a.attendance_status,case when sa.day_type='work' and sa.shift_date<=(clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date then 'absent' else sa.day_type end),
  coalesce(a.late_minutes,0),coalesce(a.original_late_minutes,a.late_minutes,0),coalesce(a.early_leave_minutes,0),coalesce(a.worked_minutes,0),
  a.source,a.adjusted_at is not null,a.adjustment_reason,adjuster.full_name,
  case when a.adjusted_at is null then null else to_char(a.adjusted_at at time zone coalesce(tz,'Africa/Cairo'),'YYYY-MM-DD HH24:MI') end
 from public.shift_assignments sa join public.employees e on e.id=sa.employee_id and e.company_id=sa.company_id
 join public.branches b on b.id=sa.branch_id and b.company_id=sa.company_id
 left join public.regions r on r.id=b.region_id and r.company_id=b.company_id
 left join lateral (select att.* from public.attendance_sessions att where att.company_id=c and att.employee_id=e.id and att.branch_id=b.id
   and (att.shift_assignment_id=sa.id or (att.shift_assignment_id is null and att.work_date=sa.shift_date))
   order by case when att.shift_assignment_id=sa.id then 0 else 1 end,coalesce(att.check_in_at,att.created_at) desc limit 1) a on true
 left join public.employees adjuster on adjuster.id=a.adjusted_by and adjuster.company_id=c
 where sa.company_id=c and sa.shift_date between p_date_from and p_date_to and (p_branch_id is null or sa.branch_id=p_branch_id)
 order by sa.shift_date,b.name,e.full_name;
end; $$;
revoke all on function public.app_attendance_admin_report(date,date,uuid) from public,anon;
grant execute on function public.app_attendance_admin_report(date,date,uuid) to authenticated;

create function public.app_save_attendance_adjustment(
 p_session_id uuid,p_employee_id uuid,p_branch_id uuid,p_work_date date,p_shift_start time,p_shift_end time,
 p_check_in_time time,p_check_out_time time,p_effective_late_minutes integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('attendance.adjust'); tz text; target public.employees;
 old_session public.attendance_sessions; session_id_value uuid:=p_session_id; in_at timestamptz; out_at timestamptz;
 worked integer; early integer:=0; late integer:=coalesce(p_effective_late_minutes,0); status_value text; new_data jsonb;
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'attendance correction reason is required' using errcode='22023'; end if;
 if p_work_date is null or p_shift_start is null or p_shift_end is null or (p_check_in_time is null and p_check_out_time is not null)
   or late<0 then raise exception 'invalid attendance correction values' using errcode='22023'; end if;
 select e.* into target from public.employees e where e.id=p_employee_id and e.company_id=c and e.deleted_at is null for update;
 if not found then raise exception 'employee is outside current company' using errcode='42501'; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside current company' using errcode='42501'; end if;
 select coalesce(co.timezone,'Africa/Cairo') into tz from public.companies co where co.id=c;
 if p_check_in_time is not null then in_at:=(p_work_date+p_check_in_time) at time zone coalesce(tz,'Africa/Cairo'); end if;
 if p_check_out_time is not null then out_at:=((p_work_date+case when p_check_out_time<p_shift_start then 1 else 0 end)+p_check_out_time) at time zone coalesce(tz,'Africa/Cairo'); end if;
 if p_check_in_time is not null and p_check_out_time is not null then
  worked:=greatest(floor(extract(epoch from (out_at-in_at))/60)::integer,0);
  early:=greatest(floor(extract(epoch from (((p_work_date+case when p_shift_end<p_shift_start then 1 else 0 end)+p_shift_end) at time zone coalesce(tz,'Africa/Cairo')-out_at))/60)::integer,0);
 end if;
 status_value:=case when p_check_in_time is null then 'absent' when p_check_out_time is null then 'open' when early>0 then 'early_leave' when late>0 then 'late' else 'present' end;
 if session_id_value is null then
  if p_check_out_time is null and exists(select 1 from public.attendance_sessions a where a.employee_id=p_employee_id and a.check_out_at is null and a.attendance_status='open') then raise exception 'employee already has an open attendance session' using errcode='23505'; end if;
  insert into public.attendance_sessions(company_id,employee_id,branch_id,work_date,check_in_at,check_out_at,source,attendance_status,
    late_minutes,early_leave_minutes,worked_minutes,original_late_minutes,adjusted_by,adjusted_at,adjustment_reason,manual_adjustment_reason)
  values(c,p_employee_id,p_branch_id,p_work_date,in_at,out_at,'admin',status_value,late,early,worked,null,public.current_employee_id(),clock_timestamp(),btrim(p_reason),btrim(p_reason)) returning id into session_id_value;
 else
  select a.* into old_session from public.attendance_sessions a where a.id=session_id_value and a.company_id=c and a.employee_id=p_employee_id and a.branch_id=p_branch_id and a.work_date=p_work_date for update;
  if not found then raise exception 'attendance session is outside the selected employee, branch, or date' using errcode='42501'; end if;
  update public.attendance_sessions set check_in_at=in_at,check_out_at=out_at,attendance_status=status_value,
   original_late_minutes=coalesce(original_late_minutes,late_minutes),late_minutes=late,early_leave_minutes=early,worked_minutes=worked,
   adjusted_by=public.current_employee_id(),adjusted_at=clock_timestamp(),adjustment_reason=btrim(p_reason),manual_adjustment_reason=btrim(p_reason),updated_at=clock_timestamp()
  where id=session_id_value and company_id=c;
 end if;
 new_data:=jsonb_build_object('check_in_at',in_at,'check_out_at',out_at,'attendance_status',status_value,'late_minutes',late,'early_leave_minutes',early,'worked_minutes',worked,'reason',btrim(p_reason));
 perform app_private.audit_company_action(c,case when p_session_id is null then 'attendance.manual_create' else 'attendance.manual_adjust' end,
  'attendance_session',session_id_value,case when p_session_id is null then null else jsonb_build_object(
   'check_in_at',old_session.check_in_at,'check_out_at',old_session.check_out_at,'attendance_status',old_session.attendance_status,
   'late_minutes',old_session.late_minutes,'early_leave_minutes',old_session.early_leave_minutes,'worked_minutes',old_session.worked_minutes,
   'adjustment_reason',old_session.adjustment_reason) end,new_data,jsonb_build_object('source','app_save_attendance_adjustment'));
 return jsonb_build_object('ok',true,'session_id',session_id_value,'message','تم حفظ التعديل مع الاحتفاظ بالسجل السابق.');
end; $$;
revoke all on function public.app_save_attendance_adjustment(uuid,uuid,uuid,date,time,time,time,time,integer,text) from public,anon;
grant execute on function public.app_save_attendance_adjustment(uuid,uuid,uuid,date,time,time,time,time,integer,text) to authenticated;
