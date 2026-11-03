# Emora Supabase Rebuild Design (Review Draft)

**State:** design and local SQL drafts only; no database changes or deployments made. Live metadata was freshly inspected on 2026-11-01. No row contents or secrets were read.

## 1. Current live baseline

Project `emora` is active on PostgreSQL 17.11. The live public application schema contains six tables:

| Table | Observed purpose/columns | Approx. rows |
|---|---|---:|
| `companies` | `id`, `name`, `code`, `created_at` | 1 |
| `regions` | `id`, `company_id`, `name`, `created_at` | 0 |
| `branches` | company/region, address, geography, radius and GPS accuracy | 0 |
| `employees` | company/branch/user, name/email, legacy `role`, `device_id` | 1 |
| `shifts` | company, name, start/end | 0 |
| `attendance_logs` | company/employee/branch, check-in/out, status | 0 |

All six have RLS enabled, none force it. `companies` and `employees` each have public `SELECT` and `INSERT` policies with unconditional `true`. The other four have no policies. Despite this, `anon` and `authenticated` have table-level `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on all six tables; `TRUNCATE` and other privileges are also broadly granted. Treat this as a critical exposure until a separately approved production change closes it.

The public function catalog has only `insert_branch_with_location(...)` (SECURITY DEFINER, empty search path, execute granted only to `service_role`) plus the internal `rls_auto_enable()` event trigger. There are no deployed Edge Functions and no migration records. `app_current_access()` is absent. There are no live application tables for memberships, roles, permissions, shifts/attendance sessions, approvals, payroll, notifications, or audit events.

## 2. Active application dependency inventory

Active routes are `/`, `/setup`, `/login`, `/auth/callback`, `/change-password`, `/portal`, `/dashboard`, and dashboard pages `/attendance`, `/branches`, `/employees`, `/leaves`, `/notifications`, `/organization`, `/payroll`, `/penalties`, `/permissions`, `/regions`, `/reports`, `/roles`, `/settings`, and `/shifts`. Backup-suffixed pages were excluded.

| Feature | Active UI | Current backend contract and data | Readiness against the live schema |
|---|---|---|---|
| Signup/setup and company bootstrap | `/setup`, `setup-form.tsx` | `bootstrap-company` Edge Function writes companies, departments, job titles, profiles, employees, roles, permissions, role assignments, and audit logs | Blocked: most tables absent, Edge Function not deployed, and it assigns company role `SUPER_ADMIN` (not platform authority). |
| Login/access | `/login`, `/change-password`, access guard, sidebar, topbar | Supabase Auth; `app_current_access()`; `app_clear_password_change_flag()`; expected access JSON has `employee_id`, `company_id`, `full_name`, `permissions[]`, `roles[]` | Blocked: both RPCs absent live. The new migration preserves these fields and adds platform/membership context. |
| Employees and accounts | `/dashboard/employees`, `employee-account-panel.tsx` | `app_list_employees_v3`, `app_employee_options`, `app_next_employee_code`, save/status/delete/import RPCs; `manage-employee-account` Edge Function; roles, org tables, employees, auth.users | Blocked: RPCs/tables absent and account Edge source/deployment unavailable. Historical v3 output does not include all active account flags. |
| Branches and regions | `/dashboard/branches`, `/dashboard/regions` | List/save/delete/import/manager-candidate RPCs; `create-branch` local function and `insert_branch_with_location` | The live branch helper exists, but app does not invoke `create-branch`; branch/region RPCs and full columns are absent. The local function is not deployed. |
| Attendance | `/portal`, `/dashboard/attendance` | `app_my_portal`, attendance access/action RPCs, `app_save_attendance_adjustment`, `ios-web-attendance` and `legacy-web-attendance`; sessions, geofence events, shifts and devices | Blocked: source for both attendance Edge Functions is absent; no session/device tables or required RPCs are live. |
| Shifts | `/dashboard/shifts` | Workspace, scope/edit policy, templates, assignments, publish/import, shift-change requests and reviews | Blocked: required backend APIs/tables are absent. Four active shift RPC names are absent from the 100-function CSV. |
| Leave and hour permissions | `/dashboard/leaves`, `/dashboard/permissions`, `/portal` | Request/list/review/cancel/balance RPCs; leave types/requests, hour permissions and staged approvals | Blocked: APIs/tables absent; some active request RPCs are missing historically. |
| Penalties | `/dashboard/penalties` | Save/list/cancel, approval submit/review RPCs; employee penalties and approval instances | Blocked: APIs/tables absent; `app_submit_penalty_for_approval` is missing historically. |
| Payroll | `/dashboard/payroll` | Workspace, calculate/review/close/reopen/adjust RPCs; settings, cycles, items | Blocked: all dependencies absent live; financially sensitive historical functions require explicit authorization and audit review. |
| Reports/dashboard | `/dashboard`, `/dashboard/reports` | Dashboard summary, attendance/branch reports, shift workspace and access RPC | Blocked: RPCs and operational tables absent. |
| Roles/permissions/org | `/dashboard/roles`, `/dashboard/organization` | Role/permission and department/job-title list/save/delete RPCs; roles, permissions, role_permissions, employee_roles, org assignments | Blocked: no supporting live tables. Current frontend treats certain company role codes as UI admin roles; that is not backend enforcement. |
| Notifications | topbar, `/dashboard/notifications` | list/read/unread RPCs and notifications table | Blocked: missing live. |
| Settings | `/dashboard/settings` | Placeholder UI; no verified backend contract | Not implemented. |

The current source has 77 literal RPC names plus dynamic selectors. Seventy-one literal names match a historical CSV function name; six do not: `app_shift_all_accessible_workspace`, `app_shift_all_scope_access`, `app_shift_edit_policy`, `app_shift_workspace`, `app_submit_leave_request`, `app_submit_penalty_for_approval`. Dynamic leave/hour-permission reviewer and workflow selectors also need the exact call-site arguments captured in the historical contract review. Matching names do not establish compatible signatures or safe behavior.

Active literal RPC names, grouped by module:

- Access/account: `app_current_access`, `app_clear_password_change_flag`, `app_notification_unread_count`, employee device/attendance-exception status, reset/release/approve functions.
- Dashboard/attendance/reports: `app_dashboard_summary`, `app_dashboard_late_today_details`, `app_attendance_admin_report`, `app_attendance_admin_options`, `app_save_attendance_adjustment`, `app_attendance_report`, `app_branch_open_close_report`.
- Organization: branch/region/department/job-title/role list, save, delete, status and import functions; employee list/options/code/save/status/delete/import functions.
- Shifts: `app_shift_workspace`, `app_shift_all_scope_access`, `app_shift_all_accessible_workspace`, `app_shift_edit_policy`, `app_list_shift_change_requests`, `app_list_shift_leave_types`, template/assignment/import/publish and change/delete/review functions.
- Leave/hour permissions: leave list/review/cancel/submit functions; hour-permission list/review/request/cancel/balance functions.
- Penalties/payroll: penalty list/save/cancel/submit/review; payroll workspace/calculate/review/close/reopen/adjust.
- Notifications/portal: list/read/unread, `app_my_portal`, `app_my_web_attendance_access`, and employee self-service RPCs.

Historical signatures and return types live in `Supabase Snippet Untitled query (8).csv`; it contains complete function bodies but no table DDL, constraints, indexes, RLS, grants, or Edge implementations. The active app has no generated database types; multiple pages cast JSON/rows to local interfaces. Treat the export as behavior evidence to review, not executable source of truth.

Active Edge Function calls are `bootstrap-company` (local source), `manage-employee-account` (source missing), `ios-web-attendance` (source missing), and `legacy-web-attendance` (source missing). `create-branch` has local source but no active app invocation found. Live deployment inventory is empty. Current local Edge code uses `service_role`; its server-side actor and authorization checks must remain mandatory after a rebuild.

Local database artifacts are not a full migration history: `002_app_bootstrap_support.sql` defines only the branch helper; working-tree `003_auth_bootstrap_review.sql` contains grants but no function definitions; working-tree `004_audit_log_foundation.sql` is untracked and has not been deployed. The history CSV is 100 function definitions with no schema DDL. Preserve all three existing files and exports; the new review chain is separate.

## 3. Proposed target architecture

### Identity, roles and tenant selection

- `platform_admins` is a separately provisioned identity registry keyed to `auth.users`. Only a trusted database-owner provisioning process can change it. Do not derive it from `employees.role`, `roles.code`, or user-editable metadata.
- `company_memberships` is the per-user/per-company relationship. One auth user can have independent membership, employee profile, roles, and access scopes in multiple companies. Platform-only users need no membership.
- `roles`, `permissions`, `role_permissions`, and `employee_roles` are company-scoped authorization. A `SUPER_ADMIN` company role remains only a company role; the new access RPC reports platform status separately.
- `job_titles` and `departments` describe workforce organization. `direct_manager_id` and region/branch manager assignments describe hierarchy. Neither grants permissions by itself.
- Permission grants include `company`, `region`, `branch`, `department`, or `own` scope. Scoped assignment rows carry the resource scope; each operation must validate the target row and company boundary server-side.
- Company selection is a verified membership operation. `app_select_company(p_company_id)` validates the authenticated caller's active membership. Platform selection uses a separate `platform_admin_context` and `app_platform_select_company(p_company_id)`, which checks the platform registry and logs the cross-company access. It does not create a fake company membership.
- `app_current_access()` remains parameterless for current callers and returns the old fields plus `is_platform_admin` and `memberships`. For a multi-company user, it reads the stored selected company; a platform user may have a separately selected platform company. The current frontend has no company-switcher/platform UI and must be adapted before using multiple memberships or platform mode.
- Platform API contracts to add before a console exists: a company-list API; a company bootstrap/update/suspend API; a platform company-context API; and per-domain platform action APIs. Each must independently check `platform_admins`, record actor and target company, and return only scoped data. `app_platform_select_company(uuid)` in the draft is only the context/audit primitive; it is not a generic RLS bypass or a complete platform console API.

### Domain and approval model

`companies` → regions/branches/departments → employees; employee-to-branch/region scopes and manager links remain distinct. Roles map to permission codes and scope level. Attendance sessions and geofence events are separate from shift templates/assignments. Leave, hour permissions, shift changes, and penalties connect to a company-configured workflow with ordered stages, approver kind/scope, approval instance, and append-only decision history. Payroll cycles/items/settings are tenant-bound. Notifications are user-targeted. `audit_logs` records actor user, platform identity and company membership separately, affected company/entity, action/category, status, timestamp, sanitized old/new values and context.

### API security

The draft migrations expose only authentication/access bootstrap RPCs. They revoke direct browser table privileges and enable RLS on every application table, so ordinary clients have no table-level bypass. Remaining app APIs must be individually defined as functions or authenticated Edge handlers that validate `auth.uid()`, active membership, permission code, scope, approval stage, and target company. Cross-company platform functions must check `platform_admins` server-side and write an audit event in the same transaction. Do not copy all historical SECURITY DEFINER functions without review; their tenant and role semantics predate the approved platform/company separation.

## 4. Ordered local migration drafts

Files are isolated in `supabase/rebuild_migrations/` so they do not join the existing, incomplete `supabase/migrations/` chain or alter current work.

1. `0001_core_identity_organization.sql` — companies, identity, platform/company contexts, memberships, org, roles, permission/scope relations and employees.
2. `0002_attendance_and_shifts.sql` — shift, session, geofence, exception and shift-change data.
3. `0003_requests_and_approvals.sql` — leave, hour permissions, penalties, configurable staged approval data and notifications.
4. `0004_payroll_devices_audit.sql` — payroll, device state and audit log storage/indexes.
5. `0005_access_security_functions.sql` — platform check, employee/role company guard, membership sync, company context access RPCs, compatible `app_current_access()` and table privilege/RLS baseline.

These are review drafts for an empty database, not a safe patch for the present live database. They contain no `DROP`, `TRUNCATE`, or row deletion. `CREATE TABLE IF NOT EXISTS` and index creation are used where appropriate, but constraint/trigger setup assumes a single ordered clean run; rerun idempotency has not been validated. Files are deliberately outside the active CLI migration directory. Do not point the normal CLI at them until the owner selects a rebuild environment and the complete API chain is reviewed.

**Important completeness limit:** the drafts do not yet implement the 70+ operational RPCs or Edge Functions. They establish a coherent schema/access foundation and the verified access JSON contract only. The historical CSV is insufficient to reconstruct the missing six RPCs, frontend response mismatches, all table semantics, and deployment-specific Edge authorization. This is not a runnable V1 backend until those contracts are implemented and verified.

## 5. Frontend compatibility and implementation scope

Reusable without backend redesign: existing Next.js pages and presentation components, provided the caller-facing response shape stays stable. Update access interfaces to model platform identity and membership selection; do not infer authority from `SUPER_ADMIN`. The current `hasAdminAccess()` in `lib/app-access.ts` and manager workflow selection in leave/hour-permission pages are presentation routing only and must not authorize server actions.

Backend callers to update/verify before V1: login/setup/access helpers; bootstrap company owner role and initial permission catalog; employee list v3/account flags; branch save path; attendance session/action and secure iOS/web handlers; all read and mutation RPCs. A new platform admin console and company switcher are missing UI features. The available local branch Edge Function is unused from active UI and should not be treated as its current branch API.

Vercel compatibility evidence: `next.config.ts` is framework-neutral and `npm run build` maps to `next build`. No `vercel.json` is present. `open-next.config.ts`, `wrangler.jsonc`, `@opennextjs/cloudflare`, `wrangler`, and `cf:build`/`preview`/`deploy` scripts are Cloudflare-specific and should not be selected as Vercel's build path. No deployment settings were inspected or changed.

V1 should be deliberately narrow: signup/bootstrap, login/access context, one-company employee/account setup, branch setup, and a tested daily attendance check-in/out flow. This scope is only a target: it is not READY now because those core RPCs/Edge sources are missing or undeployed. Defer payroll, penalty workflows, configurable multi-stage approvals, imports, advanced reports, notifications, and platform admin console until their full authorization/audit contracts pass testing.

## 6. Verification checklist before any deployment

Run against a disposable local Supabase or isolated development project, never production:

1. Confirm PostGIS extension placement on the selected disposable Supabase version. Apply the ordered chain to an empty database; verify migration repeat behavior, constraints, indexes, functions, execute grants, RLS on every public app table, and no browser table write privileges.
2. Create a platform-only identity through the trusted provisioning path; confirm it has no company membership, cannot access company data by direct table request, and can select a company only through a platform-checked audited server API.
3. Create company owner and employee identities; verify owner is company-scoped, no company role grants platform identity, and cross-company reads/writes fail.
4. Give one auth user two memberships with different roles/scopes; verify company switching validates each membership and each access response is scoped correctly.
5. Verify branch/department/region/own scopes against both allowed and disallowed row IDs; test hierarchy does not imply permission.
6. Test configurable approvals for ordered stages, self-approval restrictions, manager/branch/region boundaries, rejected/cancelled requests and concurrent review attempts.
7. Test audit actor identity, role/membership-at-time, company, entity, timestamp, old/new safe fields, denied operations, platform access, and append-only behavior. Confirm audit failure does not misstate a successful business operation.
8. Exercise signup/login/password-change, company setup, employee account lifecycle, branch creation, attendance check-in/out, offline/error responses, and the frontend's expected shape for each API.
9. Run `npm run typecheck` and `npm run build`; confirm Vercel's standard Next build. Remove/retire Cloudflare OpenNext/Wrangler scripts only after deployment configuration review; no Vercel configuration was changed here.

## 7. Risks and unresolved decisions

- **Critical live exposure:** current grants permit broad anon/authenticated table operations; unconditional public policies expose company and employee rows. A later production change needs its own carefully staged security plan.
- **Destructive replacement:** the owner has stated live test data may be deleted, but no reset was performed. Applying a clean schema to the current populated project requires explicit approval and a verified export/restore plan; using a new isolated Supabase project avoids destructive collision.
- **No complete source of truth:** the 100-function export has no schema DDL and misses active APIs. Do not equate the export with production or copy its SECURITY DEFINER bodies wholesale.
- **Bootstrap mismatch:** current `bootstrap-company` creates `SUPER_ADMIN` and assigns every row from the current permission table. Before use, rewrite that flow to create a company owner, seed a reviewed permission catalog, create membership, and audit with a verified actor. Keep platform provisioning separate.
- **Permission catalog unresolved:** historical functions evidence many permission codes but no authoritative complete catalog/labels. Do not make an empty catalog appear usable or invent labels; reconcile active UI and historical codes before company bootstrap.
- **Audit implementation incomplete:** the schema is present in draft, but only platform/company context selection emits an audit record. All mutations, failures, Edge calls, and privileged reads still need operation-level audit logic. `service_role` remains trusted and must be kept server-side.
- **RPC/UI mismatch:** no company selector or platform UI; employee v3 fields differ; several active APIs are absent from the historical export; Edge source for account and attendance is missing.
- **Policy limitation:** the draft intentionally has RLS enabled with no direct browser table access. This is secure default-deny but every active screen remains blocked until its authorized RPC/Edge API is implemented.
- **Migration review:** SQL drafts have not been parsed/applied/tested. Cross-table deletion behavior, PostGIS extension placement, permissions/seed data and trigger interactions require validation in a disposable environment.

## 8. Approval boundary

No live database, production setting, Edge deployment, Vercel configuration, or Git state was changed. The proposed clean replacement is destructive to the existing six-table test schema and its records if a future operator resets the live project; the SQL drafts themselves do not delete them. Approval should come only after the incomplete RPC/Edge contracts and the migration chain are finished and reviewed.
