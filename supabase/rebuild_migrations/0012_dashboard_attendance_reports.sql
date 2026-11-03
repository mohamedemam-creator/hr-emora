-- Dashboard and attendance report reads. These RPCs expose only company data
-- after checking the signed-in user's company permissions.

create function public.app_dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('reports.view'); tz text; today_value date; weekly_value jsonb;
begin
 select coalesce(timezone,'Africa/Cairo') into tz from public.companies where id=c;
 today_value:=(clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date;
 select coalesce(jsonb_agg(jsonb_build_object('date',d.work_date,'label',to_char(d.work_date,'DD/MM'),'count',d.present_count) order by d.work_date),'[]'::jsonb)
 into weekly_value from (
  select x.work_date,count(distinct a.employee_id) filter(where a.check_in_at is not null)::integer present_count
  from generate_series(0,6) g(day_offset)
  cross join lateral (select today_value-6+g.day_offset as work_date) x
  left join public.shift_assignments sa on sa.company_id=c and sa.shift_date=x.work_date and sa.status='published' and sa.day_type='work'
  left join public.attendance_sessions a on a.company_id=c and a.employee_id=sa.employee_id and a.work_date=x.work_date
  group by x.work_date
 ) d;
 return jsonb_build_object(
  'employees',(select count(*) from public.employees e where e.company_id=c and e.employment_status='active' and e.deleted_at is null),
  'branches',(select count(*) from public.branches b where b.company_id=c and b.is_active),
  'regions',(select count(*) from public.regions r where r.company_id=c and r.is_active),
  'present_today',(select count(distinct a.employee_id) from public.attendance_sessions a where a.company_id=c and a.work_date=today_value and a.check_in_at is not null),
  'late_today',(select count(distinct a.employee_id) from public.attendance_sessions a where a.company_id=c and a.work_date=today_value and a.late_minutes>0),
  'weekly_attendance',weekly_value);
end; $$;
revoke all on function public.app_dashboard_summary() from public,anon;
grant execute on function public.app_dashboard_summary() to authenticated;

create function public.app_dashboard_late_today_details()
returns table(employee_id uuid,employee_code text,employee_name text,branch_id uuid,branch_name text,region_name text,
 planned_start text,check_in text,late_minutes integer)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('attendance.monitor'); tz text; today_value date;
begin
 select coalesce(timezone,'Africa/Cairo') into tz from public.companies where id=c;
 today_value:=(clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date;
 return query select e.id,e.employee_code,e.full_name,b.id,b.name,r.name,
  case when sa.planned_start is null then null else to_char(sa.planned_start,'HH24:MI') end,
  case when a.check_in_at is null then null else to_char(a.check_in_at at time zone coalesce(tz,'Africa/Cairo'),'HH24:MI') end,
  coalesce(a.late_minutes,0)
 from public.shift_assignments sa join public.employees e on e.id=sa.employee_id and e.company_id=c
 join public.branches b on b.id=sa.branch_id and b.company_id=c left join public.regions r on r.id=b.region_id and r.company_id=c
 join public.attendance_sessions a on a.company_id=c and a.employee_id=e.id and a.work_date=today_value
 where sa.company_id=c and sa.shift_date=today_value and sa.status='published' and sa.day_type='work' and a.late_minutes>0
 order by a.late_minutes desc,e.full_name;
end; $$;
revoke all on function public.app_dashboard_late_today_details() from public,anon;
grant execute on function public.app_dashboard_late_today_details() to authenticated;

create function public.app_attendance_report(p_date_from date,p_date_to date,p_branch_id uuid default null,p_region_id uuid default null)
returns table(shift_date date,employee_code text,employee_name text,branch_name text,region_name text,day_type text,
 planned_start text,planned_end text,check_in text,check_out text,attendance_status text,late_minutes integer,worked_minutes integer)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('reports.view'); tz text;
begin
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>366 then raise exception 'invalid date range' using errcode='22023'; end if;
 if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then raise exception 'branch is outside company' using errcode='42501'; end if;
 if p_region_id is not null and not exists(select 1 from public.regions r where r.id=p_region_id and r.company_id=c) then raise exception 'region is outside company' using errcode='42501'; end if;
 select coalesce(timezone,'Africa/Cairo') into tz from public.companies where id=c;
 return query select sa.shift_date,e.employee_code,e.full_name,b.name,r.name,sa.day_type,
  case when sa.planned_start is null then null else to_char(sa.planned_start,'HH24:MI') end,
  case when sa.planned_end is null then null else to_char(sa.planned_end,'HH24:MI') end,
  case when a.check_in_at is null then null else to_char(a.check_in_at at time zone coalesce(tz,'Africa/Cairo'),'YYYY-MM-DD HH24:MI') end,
  case when a.check_out_at is null then null else to_char(a.check_out_at at time zone coalesce(tz,'Africa/Cairo'),'YYYY-MM-DD HH24:MI') end,
  coalesce(a.attendance_status,case when sa.day_type='work' and sa.shift_date<=((clock_timestamp() at time zone coalesce(tz,'Africa/Cairo'))::date) then 'absent' else sa.day_type end),
  coalesce(a.late_minutes,0),coalesce(a.worked_minutes,0)
 from public.shift_assignments sa join public.employees e on e.id=sa.employee_id and e.company_id=c
 join public.branches b on b.id=sa.branch_id and b.company_id=c left join public.regions r on r.id=b.region_id and r.company_id=c
 left join lateral (select x.* from public.attendance_sessions x where x.company_id=c and x.employee_id=e.id and (x.shift_assignment_id=sa.id or (x.shift_assignment_id is null and x.work_date=sa.shift_date)) order by coalesce(x.check_in_at,x.created_at) desc limit 1) a on true
 where sa.company_id=c and sa.shift_date between p_date_from and p_date_to and (p_branch_id is null or sa.branch_id=p_branch_id) and (p_region_id is null or b.region_id=p_region_id)
 order by sa.shift_date,b.name,e.full_name;
end; $$;
revoke all on function public.app_attendance_report(date,date,uuid,uuid) from public,anon;
grant execute on function public.app_attendance_report(date,date,uuid,uuid) to authenticated;

-- Branch opening/closing report consumed by the existing reports page.
-- The report derives opening from the earliest real check-in and closing from
-- the latest real checkout. Planned boundaries use the first/last published
-- work shift for that branch/date; no legacy fixed opening hour is assumed.
create function public.app_branch_open_close_report(p_date_from date,p_date_to date,p_branch_id uuid default null)
returns table(report_date date,branch_id uuid,branch_name text,branch_code text,region_name text,
 scheduled_employees integer,checked_in_employees integer,planned_open text,actual_open text,opening_delay_minutes integer,
 opened_by_name text,opened_by_code text,planned_close text,actual_close text,early_close_minutes integer,
 closed_by_name text,closed_by_code text,open_sessions integer,auto_closed_sessions integer,open_status text,close_status text)
language plpgsql stable security definer set search_path=''
as $$
declare c uuid:=app_private.require_company_permission('reports.view'); tz text;
begin
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>366 then
  raise exception 'invalid date range' using errcode='22023';
 end if;
 if p_branch_id is not null and not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=c) then
  raise exception 'branch is outside company' using errcode='42501';
 end if;
 select coalesce(timezone,'Africa/Cairo') into tz from public.companies where id=c;
 return query
 with accessible_branches as (
  select b.id,b.name,b.code,r.name as region_name from public.branches b
  left join public.regions r on r.id=b.region_id and r.company_id=c
  where b.company_id=c and b.is_active and (p_branch_id is null or b.id=p_branch_id)
 ), schedules as (
  select sa.branch_id,sa.shift_date as report_date,
   min((sa.shift_date+sa.planned_start) at time zone coalesce(tz,'Africa/Cairo')) as planned_open_at,
   max((sa.shift_date+sa.planned_end) at time zone coalesce(tz,'Africa/Cairo')) as planned_close_at,
   count(distinct sa.employee_id)::integer as scheduled_count
  from public.shift_assignments sa join accessible_branches b on b.id=sa.branch_id
  where sa.company_id=c and sa.shift_date between p_date_from and p_date_to
   and sa.status in ('published','completed') and sa.day_type='work'
   and sa.planned_start is not null and sa.planned_end is not null
  group by sa.branch_id,sa.shift_date
 ), attendance as (
  select a.branch_id,a.work_date as report_date,
   min(a.check_in_at) as actual_open_at,
   max(a.check_out_at) filter(where a.check_out_at is not null and a.attendance_status<>'missing_checkout' and a.source<>'system') as actual_close_at,
   count(distinct a.employee_id) filter(where a.check_in_at is not null)::integer as checked_in_count,
   count(*) filter(where a.check_out_at is null and a.attendance_status='open')::integer as open_count,
   count(*) filter(where a.attendance_status='missing_checkout' or a.source='system')::integer as auto_closed_count
  from public.attendance_sessions a join accessible_branches b on b.id=a.branch_id
  where a.company_id=c and a.work_date between p_date_from and p_date_to
  group by a.branch_id,a.work_date
 ), first_in as (
  select distinct on(a.branch_id,a.work_date) a.branch_id,a.work_date,e.full_name,e.employee_code
  from public.attendance_sessions a join public.employees e on e.id=a.employee_id and e.company_id=c
  join accessible_branches b on b.id=a.branch_id
  where a.company_id=c and a.work_date between p_date_from and p_date_to and a.check_in_at is not null
  order by a.branch_id,a.work_date,a.check_in_at,a.id
 ), last_out as (
  select distinct on(a.branch_id,a.work_date) a.branch_id,a.work_date,e.full_name,e.employee_code
  from public.attendance_sessions a join public.employees e on e.id=a.employee_id and e.company_id=c
  join accessible_branches b on b.id=a.branch_id
  where a.company_id=c and a.work_date between p_date_from and p_date_to and a.check_out_at is not null
   and a.attendance_status<>'missing_checkout' and a.source<>'system'
  order by a.branch_id,a.work_date,a.check_out_at desc,a.id desc
 ), report_keys as (
  select s.branch_id,s.report_date from schedules s union select a.branch_id,a.report_date from attendance a
 ), combined as (
  select k.report_date,b.id as branch_id,b.name as branch_name,b.code as branch_code,b.region_name,
   coalesce(s.scheduled_count,0)::integer as scheduled_count,coalesce(a.checked_in_count,0)::integer as checked_in_count,
   s.planned_open_at,a.actual_open_at,s.planned_close_at,a.actual_close_at,
   coalesce(a.open_count,0)::integer as open_count,coalesce(a.auto_closed_count,0)::integer as auto_closed_count,
   fi.full_name as opener_name,fi.employee_code as opener_code,lo.full_name as closer_name,lo.employee_code as closer_code
  from report_keys k join accessible_branches b on b.id=k.branch_id
  left join schedules s on s.branch_id=k.branch_id and s.report_date=k.report_date
  left join attendance a on a.branch_id=k.branch_id and a.report_date=k.report_date
  left join first_in fi on fi.branch_id=k.branch_id and fi.work_date=k.report_date
  left join last_out lo on lo.branch_id=k.branch_id and lo.work_date=k.report_date
 )
 select x.report_date,x.branch_id,x.branch_name,x.branch_code,x.region_name,x.scheduled_count,x.checked_in_count,
  case when x.planned_open_at is null then null else to_char(x.planned_open_at at time zone coalesce(tz,'Africa/Cairo'),'HH24:MI') end,
  case when x.actual_open_at is null then null else to_char(x.actual_open_at at time zone coalesce(tz,'Africa/Cairo'),'HH24:MI') end,
  case when x.planned_open_at is null or x.actual_open_at is null then 0 else greatest(floor(extract(epoch from (x.actual_open_at-x.planned_open_at))/60)::integer,0) end,
  x.opener_name,x.opener_code,
  case when x.planned_close_at is null then null else to_char(x.planned_close_at at time zone coalesce(tz,'Africa/Cairo'),'HH24:MI') end,
  case when x.actual_close_at is null then null else to_char(x.actual_close_at at time zone coalesce(tz,'Africa/Cairo'),'HH24:MI') end,
  case when x.open_count>0 or x.planned_close_at is null or x.actual_close_at is null then 0 else greatest(floor(extract(epoch from (x.planned_close_at-x.actual_close_at))/60)::integer,0) end,
  x.closer_name,x.closer_code,x.open_count,x.auto_closed_count,
  case when x.planned_open_at is null and x.actual_open_at is not null then 'opened_without_schedule'
   when x.actual_open_at is null then 'not_opened'
   when x.actual_open_at>x.planned_open_at then 'late_open' else 'on_time' end,
  case when x.planned_close_at is null and x.actual_close_at is not null then 'closed_without_schedule'
   when x.planned_close_at is null then 'no_schedule'
   when x.open_count>0 and x.report_date=(now() at time zone coalesce(tz,'Africa/Cairo'))::date then 'open_now'
   when x.open_count>0 then 'unclosed_session'
   when x.actual_close_at is null and x.auto_closed_count>0 then 'no_real_checkout'
   when x.actual_close_at is null then 'no_checkout'
   when x.actual_close_at<x.planned_close_at then 'early_close' else 'on_time' end
 from combined x order by x.report_date desc,x.branch_name;
end; $$;
revoke all on function public.app_branch_open_close_report(date,date,uuid) from public,anon;
grant execute on function public.app_branch_open_close_report(date,date,uuid) to authenticated;
