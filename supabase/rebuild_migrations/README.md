# Emora greenfield backend migration chain

This is the ordered schema source for the new empty Emora backend. It is intentionally isolated from the pre-existing `supabase/migrations/` directory, whose files are partial historical work and must not be mixed into a greenfield deployment. Preserve those files; do not point a deployment at them.

Run these files in lexical order only through the approved migration workflow. The live project currently records rebuild migrations 0001 and 0002, plus the separately prepared `supabase/migrations/0002a_security_baseline.sql` security baseline. Migrations 0003–0017 remain pending. No reset, deployment, Auth user creation, or test-data write has been performed. The baseline has enabled and forced RLS and removed anon/PUBLIC table access; until the RPC/policy migrations are installed, direct app access remains blocked.

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

The local `ios-web-attendance` Edge Function verifies the enrolled P-256 browser key and forwards the caller JWT to permission-checked RPCs. The active leave, hour permission, penalty, payroll, and account-device calls have local definitions. Leave types are seeded as generic paid/unpaid choices during company bootstrap, with no statutory entitlement; companies can configure these types in Settings. Annual entitlement is stored as configuration but is not yet enforced as a balance. Leave attachment-required types cannot be submitted because the portal has no upload flow. Leave and hour approval currently use one company-level permission decision; multi-stage workflow definitions are not exposed or enforced by an active configuration UI.

The branch opening/closing report is available from migration 0012. It derives actual opening from the earliest attendance check-in and closing from the latest real employee checkout. Planned boundaries use the earliest/latest published work shifts for the branch and date. This intentionally avoids importing the historical fixed 10:00 opening policy, which is not represented in the greenfield schema. Access is company-scoped through `reports.view`; branch ids are validated against the caller's company.

Mobile-device registration itself is outside the current web application's source. SQL/Edge runtime tests and three-account acceptance tests remain outstanding because no disposable Postgres/Deno/Supabase CLI is available. A successful Next.js typecheck or build does not validate SQL or Edge runtime behavior. See [the design and compatibility map](../../docs/supabase-rebuild-design.md).

Payroll uses existing product evidence: monthly salaries are prorated from actual regular hours using `monthly_divisor` and a 9-hour default day; daily salaries use days present/paid leave/mission; hourly salaries use recorded regular minutes; monthly overtime applies the configured multiplier; day-based penalty conversion uses the existing 8-hour daily convention for hourly salaries. These rules need owner/accounting review before payroll is enabled for live use.

After the project owner creates the first Auth identity and verifies its UUID, platform provisioning is a database-owner-only operation. There is deliberately no browser-callable platform grant function. A trusted owner can provision with:

```sql
insert into public.platform_admins(user_id, granted_at, granted_by, grant_reason)
values ('<verified-auth-user-uuid>', clock_timestamp(), null, 'Initial platform administrator bootstrap');
```

Run this only in the approved database-owner context after the migration chain is reviewed and applied to the intended environment. Never infer or grant platform authority from a company role.
