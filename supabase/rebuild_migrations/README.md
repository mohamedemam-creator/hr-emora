# Emora greenfield backend migration chain

This is the ordered schema source for the new empty Emora backend. It is intentionally isolated from the pre-existing `supabase/migrations/` directory, whose files are partial historical work and must not be mixed into a greenfield deployment. Preserve those files; do not point a deployment at them.

Run these files in lexical order only through the approved migration workflow. A prior live-state note listed rebuild migrations 0001 and 0002 plus the separately prepared `supabase/migrations/0002a_security_baseline.sql`; that note has not been refreshed against Supabase during this local implementation. No reset, deployment, Auth user creation, or test-data write is performed by local implementation work. Until the approved RPC/policy migrations are installed, direct app access remains blocked.

Files:

1. `0001_core_identity_organization.sql` — tenant identity, memberships, roles, permissions, and company structure.
2. `0002_attendance_and_shifts.sql` — schedules, sessions, geofence and schedule-change records.
3. `0003_requests_and_approvals.sql` — leave, hour permissions, penalties, configurable approval stages, and notifications.
4. `0004_payroll_devices_audit.sql` — payroll, attendance device state, and audit records.
5. `0005_access_security_functions.sql` — profile/membership triggers, separate platform/company context, access RPC, grants, and RLS baseline.
6. `0006_company_bootstrap_and_role_catalog.sql` — reviewed permission catalog, customer signup transaction, default company roles, and initial platform company list/update RPCs.
7. `0007_employee_management.sql` — employee list/options/save/archive/import, verified-email invitation activation, and server-only account context APIs.
8. `0008_company_organization_apis.sql` — region, branch, department, job-title, and role APIs with tenant validation and audit events.
9. `0009_attendance_portal_foundation.sql` — attendance actions, employee portal, attendance review, and corrections.
10. `0010_shift_management_apis.sql` — schedule workspace, templates, publishing, imports, and employee schedule change requests.
11. `0011_notification_apis.sql` — tenant- and employee-scoped notification reads and acknowledgements.
12. `0012_dashboard_attendance_reports.sql` — company dashboard metrics, late attendance details, and attendance reporting.
13. `0013_leave_and_hour_permission_apis.sql` — employee submissions, own-request cancellation, company review queues, approval, audit, and notifications.
14. `0014_penalty_apis.sql` — moderator penalty requests, owner approval, materialized company penalties, cancellation, and payroll-ready amounts.
15. `0015_payroll_apis.sql` — payroll calculation snapshots, workspace, review, close/reopen, and manual adjustments.
16. `0016_device_management_apis.sql` — company device management, web exceptions, iOS browser enrollment, and replay protection. The post-0005 nonce table explicitly enables RLS and has no direct client or service-role grants; the security-definer RPC is its only access path.
17. `0017_leave_type_management.sql` — company-authorized leave-type listing and create/update/deactivate RPCs used by Dashboard Settings.
18. `0018_profile_branch_and_mobile_device_apis.sql` — authenticated self-profile read, separate area/branch manager assignments, and tenant-checked mobile-device request/activation RPCs using only `active`, `released`, and `revoked` states.
19. `0019_company_leave_policies.sql` — company-level annual, monthly, and sick leave limits, leave-type quota categories, and a database trigger that enforces configured caps.
20. `0020_qualified_request_list_rpcs.sql` — replaces the leave and hour-permission list RPCs with fully qualified joined columns and refreshes the PostgREST schema cache.
21. `0021_shift_assignment_upsert.sql` — applies employee/date upserts to manager shift saves and approved shift requests to avoid duplicate-key failures while retaining company checks.

The local `ios-web-attendance` Edge Function verifies the enrolled P-256 browser key and forwards the caller JWT to permission-checked RPCs. The active leave, hour permission, penalty, payroll, and account-device calls have local definitions. Leave types are seeded as generic paid/unpaid choices during company bootstrap, with no statutory entitlement; companies can configure these types in Settings. Migration 0019 adds company-level annual, monthly, and sick caps and enforces configured limits for pending and approved requests. Leave attachment-required types cannot be submitted because the portal has no upload flow. Leave and hour approvals use the existing branch-manager review followed by area-manager final review; the workflow is fixed to those two stages rather than configurable by company.

The branch opening/closing report is available from migration 0012. It derives actual opening from the earliest attendance check-in and closing from the latest real employee checkout. Planned boundaries use the earliest/latest published work shifts for the branch and date. This intentionally avoids importing the historical fixed 10:00 opening policy, which is not represented in the greenfield schema. Access is company-scoped through `reports.view`; branch ids are validated against the caller's company.

The web portal requests a `mobile_devices` entry with `released` status, and a company owner or moderator with `devices.approve` can activate it. For iOS browsers, activation also completes the matching pending P-256 key binding; the cryptographic check remains mandatory for browser attendance. SQL/Edge runtime tests and three-account acceptance tests remain outstanding because no disposable Postgres/Deno/Supabase CLI is available. A successful Next.js typecheck or build does not validate SQL or Edge runtime behavior. See [the design and compatibility map](../../docs/supabase-rebuild-design.md).

### Applying the latest local APIs

`supabase/rebuild_migrations/` is a separate greenfield chain; the default `supabase db push` command reads `supabase/migrations/` and will not automatically include files from this directory. Apply the numbered rebuild files in lexical order with the project's approved rebuild migration runner. The branch form now calls `app_list_branches_with_managers()` and `app_save_branch_with_managers(...)`, created by migration 0018. A missing-function/schema-cache error means the migration has not been applied or PostgREST has not refreshed; 0018 and 0019 end with `NOTIFY pgrst, 'reload schema'`. No live application or migration execution was performed for these local updates.

Migration 0019 leaves annual, monthly, and sick caps unset until an owner or company administrator configures them. A blank cap means no central cap for that category. Leave requests with the matching category reserve quota while pending and consume it when approved. The `custom` category remains unlimited by company policy.

The former per-leave-type `annual_entitlement` column is retained for compatibility with older records. New settings use `company_leave_policies` and leave-type quota categories as the central source; existing historical values are preserved rather than deleted.

Payroll uses existing product evidence: monthly salaries are prorated from actual regular hours using `monthly_divisor` and a 9-hour default day; daily salaries use days present/paid leave/mission; hourly salaries use recorded regular minutes; monthly overtime applies the configured multiplier; day-based penalty conversion uses the existing 8-hour daily convention for hourly salaries. These rules need owner/accounting review before payroll is enabled for live use.

After the project owner creates the first Auth identity and verifies its UUID, platform provisioning is a database-owner-only operation. There is deliberately no browser-callable platform grant function. A trusted owner can provision with:

```sql
insert into public.platform_admins(user_id, granted_at, granted_by, grant_reason)
values ('<verified-auth-user-uuid>', clock_timestamp(), null, 'Initial platform administrator bootstrap');
```

Run this only in the approved database-owner context after the migration chain is reviewed and applied to the intended environment. Never infer or grant platform authority from a company role.
