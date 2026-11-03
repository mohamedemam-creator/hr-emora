-- The request tables are created after 0002a's one-time RLS sweep. Lock them
-- down in their own migration so they are not left exposed while later APIs
-- are installed. Application access is through authenticated RPCs only.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'leave_types', 'approval_workflow_definitions', 'request_approval_stages',
    'request_approval_workflows', 'request_approval_actions', 'leave_requests',
    'employee_hour_permissions', 'employee_penalties',
    'penalty_approval_requests', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
  end loop;
end;
$$;
