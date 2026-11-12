-- Replace list RPCs with fully qualified source columns. This forward migration
-- also repairs deployments where the earlier 0013 definitions were applied
-- before ambiguous join columns were qualified.

create or replace function public.app_list_leave_requests(p_status text default null)
returns table(
 id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,leave_type_name text,
 starts_on date,ends_on date,requested_days numeric,reason text,status text,reviewer_name text,
 reviewer_notes text,created_at timestamptz,approval_stage text,can_review boolean,
 branch_reviewer_name text,region_reviewer_name text
)
language plpgsql stable security definer set search_path=''
as $$
declare
 c uuid:=public.current_company_id();
 e uuid:=public.current_employee_id();
 can_view_all boolean:=public.has_permission('leaves.approve');
begin
 if auth.uid() is null or c is null or e is null then
  raise exception 'active employee membership required' using errcode='42501';
 end if;
 return query
 select
  leave_request.id as id,
  employee.id as employee_id,
  employee.employee_code as employee_code,
  employee.full_name as employee_name,
  branch.name as branch_name,
  leave_type.name as leave_type_name,
  leave_request.starts_on as starts_on,
  leave_request.ends_on as ends_on,
  leave_request.requested_days as requested_days,
  leave_request.reason as reason,
  leave_request.status as status,
  reviewer.full_name as reviewer_name,
  leave_request.reviewer_notes as reviewer_notes,
  leave_request.created_at as created_at,
  coalesce(workflow.current_stage,'completed') as approval_stage,
  leave_request.status='pending' and (
   (workflow.current_stage='branch' and public.has_permission('leaves.approve',workflow.branch_id,workflow.region_id,'BRANCH_MANAGER'))
   or (workflow.current_stage='region' and public.has_permission('leaves.approve',workflow.branch_id,workflow.region_id,'AREA_MANAGER'))
  ) as can_review,
  branch_reviewer.full_name as branch_reviewer_name,
  region_reviewer.full_name as region_reviewer_name
 from public.leave_requests as leave_request
 join public.employees as employee
  on employee.id=leave_request.employee_id and employee.company_id=leave_request.company_id
 join public.leave_types as leave_type
  on leave_type.id=leave_request.leave_type_id and leave_type.company_id=leave_request.company_id
 left join public.request_approval_workflows as workflow
  on workflow.company_id=leave_request.company_id and workflow.request_type='leave'
  and workflow.request_id=leave_request.id
 left join public.branches as branch
  on branch.id=employee.branch_id and branch.company_id=employee.company_id
 left join public.employees as reviewer
  on reviewer.id=leave_request.reviewed_by and reviewer.company_id=leave_request.company_id
 left join public.employees as branch_reviewer
  on branch_reviewer.id=workflow.branch_reviewed_by and branch_reviewer.company_id=workflow.company_id
 left join public.employees as region_reviewer
  on region_reviewer.id=workflow.region_reviewed_by and region_reviewer.company_id=workflow.company_id
 where leave_request.company_id=c
  and (can_view_all or leave_request.employee_id=e or leave_request.status='pending' and (
   (workflow.current_stage='branch' and public.has_permission('leaves.approve',workflow.branch_id,workflow.region_id,'BRANCH_MANAGER'))
   or (workflow.current_stage='region' and public.has_permission('leaves.approve',workflow.branch_id,workflow.region_id,'AREA_MANAGER'))
  ))
  and (p_status is null or leave_request.status=p_status)
 order by leave_request.created_at desc;
end;
$$;
revoke all on function public.app_list_leave_requests(text) from public,anon;
grant execute on function public.app_list_leave_requests(text) to authenticated;

create or replace function public.app_list_hour_permissions(p_status text default null,p_month date default null)
returns table(
 id uuid,employee_id uuid,employee_code text,employee_name text,branch_name text,
 permission_date date,permission_type text,requested_minutes integer,reason text,status text,
 reviewer_name text,review_note text,reviewed_at timestamptz,created_at timestamptz,
 approval_stage text,can_review boolean,branch_reviewer_name text,region_reviewer_name text
)
language plpgsql stable security definer set search_path=''
as $$
declare
 c uuid:=public.current_company_id();
 e uuid:=public.current_employee_id();
 can_view_all boolean:=public.has_permission('hour_permissions.approve');
 month_value date;
 timezone_value text;
begin
 if auth.uid() is null or c is null or e is null then
  raise exception 'active employee membership required' using errcode='42501';
 end if;
 select coalesce(company.timezone,'Africa/Cairo') into timezone_value
 from public.companies as company where company.id=c;
 month_value:=coalesce(
  date_trunc('month',p_month)::date,
  date_trunc('month',clock_timestamp() at time zone coalesce(timezone_value,'Africa/Cairo'))::date
 );
 return query
 select
  permission.id as id,
  employee.id as employee_id,
  employee.employee_code as employee_code,
  employee.full_name as employee_name,
  branch.name as branch_name,
  permission.permission_date as permission_date,
  permission.permission_type as permission_type,
  permission.requested_minutes as requested_minutes,
  permission.reason as reason,
  permission.status as status,
  reviewer.full_name as reviewer_name,
  permission.review_note as review_note,
  permission.reviewed_at as reviewed_at,
  permission.created_at as created_at,
  coalesce(workflow.current_stage,'completed') as approval_stage,
  permission.status='pending' and (
   (workflow.current_stage='branch' and public.has_permission('hour_permissions.approve',workflow.branch_id,workflow.region_id,'BRANCH_MANAGER'))
   or (workflow.current_stage='region' and public.has_permission('hour_permissions.approve',workflow.branch_id,workflow.region_id,'AREA_MANAGER'))
  ) as can_review,
  branch_reviewer.full_name as branch_reviewer_name,
  region_reviewer.full_name as region_reviewer_name
 from public.employee_hour_permissions as permission
 join public.employees as employee
  on employee.id=permission.employee_id and employee.company_id=permission.company_id
 left join public.request_approval_workflows as workflow
  on workflow.company_id=permission.company_id and workflow.request_type='hour_permission'
  and workflow.request_id=permission.id
 left join public.branches as branch
  on branch.id=employee.branch_id and branch.company_id=employee.company_id
 left join public.employees as reviewer
  on reviewer.id=permission.reviewed_by_employee_id and reviewer.company_id=permission.company_id
 left join public.employees as branch_reviewer
  on branch_reviewer.id=workflow.branch_reviewed_by and branch_reviewer.company_id=workflow.company_id
 left join public.employees as region_reviewer
  on region_reviewer.id=workflow.region_reviewed_by and region_reviewer.company_id=workflow.company_id
 where permission.company_id=c
  and date_trunc('month',permission.permission_date)=month_value
  and (can_view_all or permission.employee_id=e or permission.status='pending' and (
   (workflow.current_stage='branch' and public.has_permission('hour_permissions.approve',workflow.branch_id,workflow.region_id,'BRANCH_MANAGER'))
   or (workflow.current_stage='region' and public.has_permission('hour_permissions.approve',workflow.branch_id,workflow.region_id,'AREA_MANAGER'))
  ))
  and (p_status is null or permission.status=p_status)
 order by permission.permission_date desc,permission.created_at desc;
end;
$$;
revoke all on function public.app_list_hour_permissions(text,date) from public,anon;
grant execute on function public.app_list_hour_permissions(text,date) to authenticated;

notify pgrst, 'reload schema';
