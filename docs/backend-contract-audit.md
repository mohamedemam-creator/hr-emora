# Backend contract audit

Read-only comparison of active application call sites against `Supabase Snippet Untitled query (8).csv` and prior audit reports. No database query or Git operation was performed. Backup-named source files were excluded from active call sites. The CSV contains 100 complete function definitions, but is historical evidence, not proof of deployed behavior.

## RPC contract matrix

Types below are the historical CSV declarations; argument names are the PostgREST named-argument keys unless the app call site passes no arguments. `RETURNS TABLE` yields row arrays; scalar/JSONB/void responses are as declared. The app has no generated Supabase schema types, and many consumers cast `data`, so runtime shape is not validated locally. Calls generally use the named parameters shown in their call expressions; see the cited call locations. The historical signatures match those named arguments where present, except the explicitly missing calls and response discrepancy below. Historical `DEFAULT` arguments remain unverified against live.

| Active RPC | Historical signature / return | Active caller(s) / feature | Status |
|---|---|---|---|
| `app_current_access` | `()` → `jsonb` (employee_id, company_id, full_name, permissions, roles) | topbar, access guard, sidebar, setup, login, change-password, portal, dashboard, employees, permissions, shifts, reports | Historical definition available; live absent |
| `app_notification_unread_count` | `()` → scalar | topbar | Historical definition available; live absent |
| `app_clear_password_change_flag` | `()` → scalar/void | change-password | Historical definition available; live absent |
| `app_my_portal` | `()` → `jsonb` portal payload | portal | Historical definition available; live absent |
| `app_my_hour_permission_balance` | `(p_month date DEFAULT …)` → `jsonb` | portal | Historical definition available; omitted optional arg compatible only if CSV default applies |
| `app_list_my_hour_permissions` | `(p_month date DEFAULT …)` → rows | portal | Historical definition available; omitted optional arg compatible only if CSV default applies |
| `app_my_web_attendance_access` | `()` → `jsonb {allowed,reason}` | portal | Historical definition available; live absent |
| `app_submit_leave_request` | — | portal leave request | Missing from historical export; live absent |
| `app_submit_hour_permission_request` | Historical CSV declaration | portal | Historical definition available; live absent |
| `app_cancel_hour_permission_request` | Historical CSV declaration | portal | Historical definition available; live absent |
| `app_attendance_admin_report` | Historical CSV declaration | dashboard/attendance | Historical definition available; live absent |
| `app_attendance_admin_options` | `()` → JSONB `{can_adjust,branches,employees}` | dashboard/attendance | Historical definition available; live absent |
| `app_adjust_attendance` | Historical CSV declaration | dashboard/attendance | Historical definition available; live absent |
| `app_list_employees_v3` | Historical `RETURNS TABLE`; lacks `login_enabled`, `must_change_password` | dashboard/employees | Historical definition available; **response mismatch** with active employee type and account panel |
| `app_employee_options` | `()` → JSONB `{branches,departments,job_titles,roles,managers}` | dashboard/employees | Historical definition available; live absent |
| `app_next_employee_code` | Historical CSV declaration | dashboard/employees | Historical definition available; live absent |
| `app_save_employee_v2` | Historical CSV declaration | dashboard/employees | Historical definition available; live absent |
| `app_set_employee_status` | Historical CSV declaration | dashboard/employees | Historical definition available; live absent |
| `app_delete_employee` | Historical CSV declaration | dashboard/employees | Historical definition available; live absent |
| `app_import_employees_v2` | Historical CSV declaration | dashboard/employees | Historical definition available; live absent |
| `app_list_branches` | Historical CSV declaration | dashboard/branches | Historical definition available; live absent |
| `app_list_regions` | Historical CSV declaration | dashboard/branches, regions | Historical definition available; live absent |
| `app_list_region_manager_candidates` | Historical CSV declaration | dashboard/branches, regions | Historical definition available; live absent |
| `app_save_branch_with_region_manager` | Historical CSV declaration | dashboard/branches | Historical definition available; live absent |
| `app_set_branch_active` | Historical CSV declaration | dashboard/branches | Historical definition available; live absent |
| `app_delete_branch` | Historical CSV declaration | dashboard/branches | Historical definition available; live absent |
| `app_import_branches` | Historical CSV declaration | dashboard/branches | Historical definition available; live absent |
| `app_dashboard_summary` | `()` → JSONB summary | dashboard | Historical definition available; live absent |
| `app_attendance_report` | Historical CSV declaration | dashboard/reports | Historical definition available; live absent |
| `app_branch_open_close_report` | Historical CSV declaration | dashboard/reports | Historical definition available; live absent |
| `app_shift_workspace` | — | dashboard/reports and shifts | Missing from historical export; live absent |
| `app_list_roles` | Historical CSV declaration | dashboard/roles | Historical definition available; live absent |
| `app_list_permissions` | Historical CSV declaration | dashboard/roles | Historical definition available; live absent |
| `app_save_role` | Historical CSV declaration | dashboard/roles | Historical definition available; live absent |
| `app_delete_role` | Historical CSV declaration | dashboard/roles | Historical definition available; live absent |
| `app_list_penalties` | Historical CSV declaration | dashboard/penalties | Historical definition available; live absent |
| `app_save_penalty` | Historical CSV declaration | dashboard/penalties | Historical definition available; live absent |
| `app_review_penalty_request` | Historical CSV declaration | dashboard/penalties | Historical definition available; live absent |
| `app_cancel_penalty` | Historical CSV declaration | dashboard/penalties | Historical definition available; live absent |
| `app_submit_penalty_for_approval` | — | dashboard/penalties | Missing from historical export; live absent |
| `app_review_hour_permission` | Historical CSV declaration | dashboard/permissions | Historical definition available; live absent |
| `app_review_hour_permission_v2` | Historical CSV declaration | dashboard/permissions | Historical definition available; live absent |
| `app_shift_all_scope_access` | — | dashboard/shifts | Missing from historical export; live absent |
| `app_shift_all_accessible_workspace` | — | dashboard/shifts | Missing from historical export; live absent |
| `app_shift_edit_policy` | — | dashboard/shifts | Missing from historical export; live absent |
| `app_list_shift_change_requests` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_list_shift_leave_types` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_request_shift_change` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_request_shift_delete` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_review_shift_change_request` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_save_shift_template` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_delete_shift_template` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_publish_shift_week` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_import_shifts` | Historical CSV declaration | dashboard/shifts | Historical definition available; live absent |
| `app_employee_mobile_device_status` | Historical CSV declaration | employee account panel | Historical definition available; live absent |
| `app_employee_ios_web_status` | Historical CSV declaration | employee account panel | Historical definition available; live absent |
| `app_employee_web_attendance_exception_status` | Historical CSV declaration | employee account panel | Historical definition available; live absent |
| `app_approve_employee_ios_web` | Historical CSV declaration | employee account panel | Historical definition available; live absent |
| `app_reset_employee_ios_web` | Historical CSV declaration | employee account panel | Historical definition available; live absent |
| `app_list_notifications` | Historical CSV declaration; includes `notification_type` | notifications UI | Historical definition available; live absent |
| `app_mark_notification_read` | Historical CSV declaration | notifications UI | Historical definition available; live absent |
| `app_calculate_payroll` | `(p_month date)` → `uuid` | payroll action dispatcher | Historical definition available; live absent |
| `app_review_payroll_cycle` | `(p_cycle_id uuid)` → `void` | payroll action dispatcher | Historical definition available; live absent |
| `app_close_payroll_cycle` | `(p_cycle_id uuid)` → `void` | payroll action dispatcher | Historical definition available; live absent |
| `app_payroll_workspace` | Historical JSONB workspace | payroll | Historical definition available; live absent |
| `app_adjust_payroll_item` | `(p_item_id uuid,p_manual_earnings numeric,p_manual_deductions numeric,p_notes text)` → `void` | payroll | Historical definition available; live absent |
| `app_reopen_payroll_cycle` | Historical CSV declaration | payroll | Historical definition available; live absent |
| `app_save_payroll_settings` | Historical CSV declaration | payroll | Historical definition available; live absent |
| `app_import_attendance` | Historical CSV declaration | attendance import | Historical definition available; live absent |
| `app_import_employees` | Historical CSV declaration | employee import | Historical definition available; live absent |
| `app_import_penalties` | Historical CSV declaration | penalties import | Historical definition available; live absent |
| `app_import_regions` | Historical CSV declaration | regions import | Historical definition available; live absent |
| `app_import_shifts` | Historical CSV declaration | shift import | Historical definition available; live absent |
| `app_save_region` | Historical CSV declaration | regions | Historical definition available; live absent |
| `app_delete_region` | Historical CSV declaration | regions | Historical definition available; live absent |
| `app_save_attendance_adjustment` | Historical CSV declaration | attendance | Historical definition available; live absent |
| `app_my_attendance_history` | Historical CSV declaration | portal | Historical definition available; live absent |
| `app_my_leave_requests` | Historical CSV declaration | portal | Historical definition available; live absent |

**Counting note:** Active call-site enumeration finds 79 unique RPC names when conditional alternatives and the payroll dispatcher are resolved. The matrix above records the principal names evidenced by the targeted call-site scan and CSV. The earlier audit independently confirms 73 historical overlaps and six absent names listed above. Exact argument objects and per-call TypeScript response casts remain in the cited source locations; do not infer compatibility solely from function name.

### Historical signatures and behavior

The CSV’s 73 active matches expose parameter names/types and return declarations; they are complete function bodies, not snippets. All 73 are `SECURITY DEFINER` and pin `search_path` to empty. Their bodies reference helper routines as well as relations; helper implementations and grants are not fully supplied by the CSV. `app_current_access` returns JSONB containing role/permission arrays. `app_dashboard_summary`, `app_employee_options`, `app_attendance_admin_options`, payroll workspace, portal and import functions return JSONB; callers inspect/cast nested objects. Table-returning RPC callers expect arrays. Exact detailed SQL should be treated as historical evidence from the CSV path, not a present live contract.

## Table and column dependency matrix

| Relations / columns | Referenced by | Local/historical evidence | Live inventory | Status |
|---|---|---|---|---|
| `companies(id,name,code,created_at)` | access, setup, tenant filtering | historical CSV and setup Edge source | present | Partial overlap; live does not establish app contract |
| `regions(id,company_id,name,code,is_active,manager_employee_id,…)` | region list/save, branch UI, access | CSV and active region/branch views | present only with `id,company_id,name,created_at` | Missing columns in live |
| `branches(id,company_id,region_id,name,code,address,location,attendance_radius_m,minimum_gps_accuracy_m,latitude,longitude,is_active,…)` | branches, attendance, reports, shifts | CSV and app types; create-branch migration/source | present with subset; geography `location` present | Missing app-facing fields/derived output columns |
| `employees(id,company_id,branch_id,user_id,full_name,email,role,device_id,employee_code,phone,address,department_id,job_title_id,direct_manager_id,hire_date,salary_type,base_salary,overtime_hour_rate,employment_status,has_login,login_enabled,must_change_password,…)` | auth/access, employees, portal, payroll, attendance, penalties | CSV and active employee types | present with `id,company_id,branch_id,user_id,full_name,email,role,device_id,created_at` | Many expected columns absent; v3 output discrepancy |
| `shifts(id,company_id,name,start_time,end_time,created_at)` | legacy shifts/attendance | CSV and live audit | present | Basic overlap only; current scheduling uses templates/assignments |
| `attendance_logs(id,company_id,employee_id,branch_id,check_in,check_out,status,created_at)` | legacy attendance and reporting | live audit | present | Modern session/GPS evidence not represented |
| `departments,job_titles,roles,permissions,role_permissions,employee_roles` | employee options, access, role admin | CSV | absent live | Missing dependencies |
| `employee_branch_assignments,employee_region_assignments` | scoped access and assignment logic | CSV | absent live | Missing dependencies |
| `attendance_sessions,geofence_events,mobile_devices,ios_web_devices,ios_web_device_requests,web_attendance_exceptions` | portal/web/mobile attendance and account panel | CSV and active callers | absent live | Missing dependencies |
| `shift_templates,shift_assignments,shift_change_requests,leave_types,leave_requests` | shifts, employee portal, approvals | CSV and active callers | absent live | Missing dependencies |
| `employee_hour_permissions,employee_penalties,penalty_approval_requests,request_approval_workflows` | permissions, penalties and approval flows | CSV and active callers | absent live | Missing dependencies |
| `payroll_cycles,payroll_items,payroll_settings` | payroll workspace/actions | CSV and active payroll code | absent live | Missing dependencies |
| `notifications,audit_logs` | topbar/notifications and function audit trails | CSV and active callers | absent live | Missing dependencies |
| `profiles` | bootstrap-company Edge handler | local Edge source only | absent live | Missing from historical function relation list/live inventory |

Historical CSV references 32 public relations: `attendance_sessions`, `audit_logs`, `branches`, `companies`, `departments`, `employee_branch_assignments`, `employee_hour_permissions`, `employee_penalties`, `employee_region_assignments`, `employee_roles`, `employees`, `geofence_events`, `ios_web_device_requests`, `ios_web_devices`, `job_titles`, `leave_requests`, `leave_types`, `mobile_devices`, `notifications`, `payroll_cycles`, `payroll_items`, `payroll_settings`, `penalty_approval_requests`, `permissions`, `regions`, `request_approval_workflows`, `role_permissions`, `roles`, `shift_assignments`, `shift_change_requests`, `shift_templates`, `web_attendance_exceptions`. Only four overlap the six-table live inventory. Live schema inventory is from `docs/supabase-audit.md`; this task performed no live queries.

## Edge Function matrix

| Invocation | Caller / expected request and response | Local source | Live deployment status |
|---|---|---|---|
| `bootstrap-company` | `app/setup/setup-form.tsx`; sends companyName, companyCode, adminName, employeeCode, phone; expects `{ok,companyId}` | `supabase/functions/bootstrap-company/index.ts` | No deployed function per prior audit; source depends on additional tables including profiles/departments/job_titles |
| `manage-employee-account` | `components/employee-account-panel.tsx`, `app/dashboard/employees/page.tsx`; create/reset-password/update-email/enable/disable with employeeId/email/password; callers expect error/message | No local source found | No deployed function per prior audit; contract cannot be verified |
| `ios-web-attendance` | `app/portal/page.tsx`; status/request_binding/signed, browser binding and attendance data; expects bound/pending/requestCode/deviceCode/code/message or distance/accuracy | No local source found | No deployed function per prior audit; security/signature contract unreconstructable |
| `legacy-web-attendance` | `app/portal/page.tsx`; status/position/attendance with action/coordinates/accuracy; expects message/error | No local source found | No deployed function per prior audit; contract unreconstructable |
| `create-branch` (local only; no app invocation found) | Local function accepts branch/region/location fields and returns `{ok,branch}`; calls `insert_branch_with_location` | `supabase/functions/create-branch/index.ts` | Not deployed per prior audit. Local helper exists in migration and live catalog, but does not imply function deployment |

## Missing and incompatible contracts

- Six active RPCs are absent from the 100-function CSV: `app_submit_penalty_for_approval`, `app_shift_workspace`, `app_shift_all_scope_access`, `app_shift_all_accessible_workspace`, `app_shift_edit_policy`, `app_submit_leave_request`. Their arguments, response shapes, table dependencies and behavior cannot be established from same-name assumptions.
- `app_list_employees_v3` historical rows omit `login_enabled` and `must_change_password`, while active employee/account UI types and reads require them. Historical `app_list_employees_v2` includes those flags, but the active app calls v3; v2 is not evidence v3 has equivalent output.
- Historical app RPC definitions are not in the live catalog recorded in the prior audit. Therefore none of the 73 CSV matches is confirmed deployed. The live catalog's `insert_branch_with_location` helper is a distinct contract.
- Active app dependencies greatly exceed the six live tables. Do not attempt implementation from CSV alone: 28 of its 32 referenced public relations are missing from the recorded live inventory, before column-level gaps.
- Four active Edge invocations lack local function source; the one available local source is not deployed. Invocation payloads do not reconstruct server-side authorization, validation, secrets, or side effects.
- CSV contains no DDL for tables, indexes, constraints, RLS policies, grants, triggers, or types. It cannot rebuild a complete backend.

## Unresolved questions

1. What is the authoritative deployed contract/version for the 73 historical RPCs and six missing RPCs? Prior live audit says absent, but this audit intentionally performs no live query.
2. What exact argument and response contracts do the four missing historical RPCs and four unavailable Edge handlers implement?
3. Are all JSONB fields nullable/optional, and what are the exact nested schemas expected by app casts?
4. Which historical helper functions, enums/types, triggers, constraints, grants and RLS policies are required by the SQL bodies?
5. Is there a current complete schema/Edge source outside the inspected repository history and CSV?

## Recommended implementation order

1. Treat the actual deployed schema and service contracts as the source of truth; obtain a fresh read-only inventory and function definitions before implementation (the present task deliberately did not access live Supabase).
2. Recover/verify missing RPC and Edge Function source, including authorization behavior, exact input/output types and dependencies.
3. Reconcile table/column prerequisites, enums, helper functions, triggers, indexes, constraints, RLS and grants against evidence; resolve the employee v3 output mismatch.
4. Build typed client contracts and map every active caller to verified server definitions; remove reliance on unchecked casts only after contracts are confirmed.
5. Plan any eventual schema recovery as a separately reviewed, staged implementation preserving production data. No implementation or database action is authorized by this audit.
