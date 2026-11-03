-- Final stage only: close the confirmed unconditional public setup policies and
-- direct browser table access after secure replacement paths pass staging tests.
-- Do not apply before 004_audit_log_foundation.sql, the login foundation, and the
-- bootstrap-company Edge Function are deployed and verified.

alter policy "Allow setup insert" on public.companies to service_role;
alter policy "Allow setup select" on public.companies to service_role;
alter policy "Allow setup insert" on public.employees to service_role;
alter policy "Allow setup select" on public.employees to service_role;

revoke all privileges on table
  public.companies,
  public.regions,
  public.branches,
  public.employees,
  public.shifts,
  public.attendance_logs
from public, anon, authenticated;
