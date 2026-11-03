# Emora Implementation Progress

Checkpoint: 2026-11-02. Live database state and local implementation status are separated below. No Auth user or test record has been created, and no Edge Function has been deployed.

## Supabase Cloud activation preflight (read-only)

- The Supabase integration returned one active project: `ldmaxojfhewutvuykhay` (`supabase-champagne-feather`), URL `https://ldmaxojfhewutvuykhay.supabase.co`, region `us-east-1`, Postgres `17.11.0.003`. The project name is generic; the connected integration exposes no second candidate. The user identified the connected project as Emora's new live target, but its project name alone does not independently prove that identity.
- Live state: zero public tables, zero Emora RPC/private functions, zero public RLS policies, zero application triggers, zero Auth users, zero recorded Supabase migrations, and zero deployed Edge Functions. PostGIS is available but not installed. Inspection was read-only; no DDL or data changes were made.
- Local chain: latest file is `0017_leave_type_management.sql`; there are 17 ordered SQL files. All 17 are pending because live migration history is empty.
- Static review found no duplicate local table, index, trigger, or function definitions. Dependencies align with the 0001–0017 ordering. No table drop or truncate appears in the chain. Migration 0005 has `DROP TRIGGER IF EXISTS` for named application triggers; the inspected target has no application triggers. The chain defines scoped delete operations inside callable application functions; these do not execute merely by applying the migrations. Migration 0001 creates the `extensions` schema and installs PostGIS, which is currently available but uninstalled.
- Corrected one local security gap before this preflight: `0016_device_management_apis.sql` creates `ios_web_signature_nonces` after 0005's RLS sweep, so 0016 now enables RLS and revokes direct grants. Its authenticated nonce RPC is the only intended access path.
- Execution limitations: Supabase CLI, local PostgreSQL, Deno, Docker, and `supabase/config.toml` are unavailable. No local SQL engine could compile the chain. The connected Supabase migration tool is available for individually applying ordered migrations after explicit approval. The local `.env.local` was not inspected, so application URL alignment was not checked.
- At the preflight checkpoint, the chain was prepared but not runtime-validated and execution was awaiting target confirmation/approval. The subsequent execution outcome is recorded below.

## Live migration execution — stopped at first error

- Target was re-verified as `ldmaxojfhewutvuykhay` immediately before execution. The user explicitly confirmed it as the intended Emora LIVE backend and authorized ordered migrations 0001–0017.
- Applied successfully through the Supabase migration integration: `0001_core_identity_organization` (recorded version `20261102124647`) and `0002_attendance_and_shifts` (recorded version `20261102124659`).
- `0003_requests_and_approvals.sql` was rejected. Exact tool response: `ERROR: 42701: column "reviewed_at" specified more than once`. The local `penalty_approval_requests` definition declares `reviewed_at timestamptz` twice (around lines 98 and 100). The migration is not recorded; dependent migrations 0004–0017 were not submitted. No Auth users, test records, or Edge Functions were created/deployed.
- Read-only verification after the failure: migration history contains only 0001 and 0002; 24 public tables exist and list as empty; no Emora RPCs/private functions or public policies exist. RLS is disabled on all 24 tables. `anon` currently has SELECT and INSERT on all 24 tables. This is a critical temporary exposure until access controls are installed; the project is live even though it currently has no application rows.
- No migration, repair, or RLS hotfix was attempted after the 0003 error. The ordered sequence remains stopped at the first error as instructed.
- The 0003 error was corrected locally by retaining one nullable `reviewed_at timestamptz` column in `penalty_approval_requests`; a scan of all table definitions in that file now finds no duplicate columns. The requested `supabase/migrations/0003_requests_and_approvals.sql` path does not exist, so the actual greenfield source `supabase/rebuild_migrations/0003_requests_and_approvals.sql` was corrected instead.
- Added local-only `supabase/migrations/0002a_security_baseline.sql`, which dynamically enables and forces RLS on existing public tables, revokes the requested table/sequence privileges, and restricts default privileges for future public objects. It creates no policies and has not been applied. No live changes followed the migration failure.
- Next database action is to review the local security baseline and 0003 correction, then explicitly authorize applying the baseline and resuming the corrected chain. The first accepted application journey test should wait until migrations 0001–0017 complete and live RLS/grants/RPC verification passes; test-user/data creation needs separate approval.

## Current live security baseline status

- Target `ldmaxojfhewutvuykhay` was re-confirmed immediately before applying the revised `supabase/migrations/0002a_security_baseline.sql` through the Supabase migration integration.
- Applied and recorded as `0002a_security_baseline`, version `20261102174615`. The revision removes the `supabase_admin` default-privilege statements that previously failed under the `postgres` execution role; it retains the explicit `postgres` default ACL changes.
- Live verification: 24 public tables, all 24 with RLS enabled and forced; zero with RLS disabled or not forced. `anon` has no SELECT or INSERT on these tables; `authenticated` has no TRUNCATE, TRIGGER, or REFERENCES privileges. The `postgres` default ACLs no longer grant to `anon` or `PUBLIC`.
- Security Advisor: zero `rls_disabled_in_public` errors. It reports 24 informational `rls_enabled_no_policy` findings because no access policies or application RPCs have been installed yet. Do not treat this as tenant authorization being complete; direct table access is currently fail-closed.
- Migration 0003 remains unapplied pending the Architect's explicit approval. Its duplicate `reviewed_at` declaration is corrected locally in `supabase/rebuild_migrations/0003_requests_and_approvals.sql`; no policies/RLS or grants are added by that migration file.

## Current status

| Area | Status | Local evidence / remaining gap |
|---|---|---|
| Identity, tenant model, roles, permissions, platform identity | Implemented locally | Migrations 0001, 0005–0008. Requires execution in disposable/staging Supabase and acceptance tests. |
| Company signup/bootstrap and employee account setup | Implemented locally | Migration 0006 and Edge Function/app flows. Runtime behavior not verified. |
| Branches, organization, employee management | Implemented locally | Migrations 0007–0008 and active dashboard calls. Runtime behavior not verified. |
| Shifts and attendance | Implemented locally | Migrations 0002, 0009–0010 plus Edge Functions. SQL and Edge runtime remain unverified. |
| Notifications, dashboard and attendance reports | Implemented locally | Migrations 0011–0012. Branch opening/closing report added in 0012 with company-scoped `reports.view`. |
| Leave requests and company review | Partially implemented | Migration 0013 supplies submit/list/cancel/review and audit/notifications. One company permission approval only; no staged workflow configuration/enforcement, attachment upload, or annual entitlement enforcement. |
| Hour-permission requests and review | Partially implemented | Migration 0013 supplies request/list/balance/review/cancel. Requires a published work shift, supports the existing 60/120/240-minute choices and 240-minute current-month cap, and blocks self-review. Approval is one company-level decision. |
| Leave-type setup | Implemented locally | Migration 0017 and Dashboard Settings RPC UI. Bootstrap seeds generic paid/unpaid types with no default statutory entitlement. |
| Penalties | Implemented locally | Migration 0014 and dashboard integration; runtime and accounting review remain. |
| Payroll | Partially implemented | Migration 0015 and dashboard integration. Formula choices are documented in the migration README and need owner/accountant review; no payroll runtime test. |
| Device management / iOS web attendance | Partially implemented | Migration 0016 and local Edge Function exist. No Deno/Supabase runtime or device acceptance test is available. Native mobile device registration is outside the active web app. |
| Multi-stage approvals, attachments, annual leave balances | Missing | Tables exist for staged approvals, but active configuration/decision flow is not implemented; upload and entitlement behavior are also absent. |

## Changes in this continuation

- Updated `supabase/rebuild_migrations/0006_company_bootstrap_and_role_catalog.sql` to seed generic paid and unpaid leave types for new companies and add the leave-type management permission.
- Updated `supabase/rebuild_migrations/0013_leave_and_hour_permission_apis.sql` with concurrency protection, company-timezone month defaults, published-shift validation, and the existing UI's cancellation response contract.
- Added `supabase/rebuild_migrations/0017_leave_type_management.sql` and replaced the Settings placeholder with leave-type configuration UI in `app/dashboard/settings/page.tsx`; added styles in `app/globals.css`.
- Added `app_branch_open_close_report` to `supabase/rebuild_migrations/0012_dashboard_attendance_reports.sql` using the existing frontend response shape and current company permission checks. Updated `app/dashboard/reports/page.tsx` to gate that tab using `reports.view`, not historical role names.
- Hardened the nonce table in `supabase/rebuild_migrations/0016_device_management_apis.sql`: it is created after the original RLS sweep, so this migration now explicitly enables RLS and revokes direct table privileges.
- Updated `supabase/rebuild_migrations/README.md` with migration 0017, assumptions, and remaining validation gaps.

## Checks performed

- `npm run typecheck` — passed after the application changes.
- `git diff --check` — passed; Git emitted existing LF/CRLF working-copy notices.
- `npm run build` — compilation and integrated TypeScript passed, but Next static page generation failed twice with `EPERM` while attempting to create generated directories under `.next/server/app` (`/login`, then `/_not-found`). The failure moved to a different route on retry and appears to be an environment/filesystem blocker; `.next` was not cleared or manually altered.
- Lint — unavailable: `package.json` has no lint script or configured lint dependency.
- SQL execution / migration validation — not performed: no local disposable PostgreSQL, Deno, or Supabase CLI was available. The live Supabase project was not contacted.
- Authentication, company signup, leave/hour, payroll, device, and iOS end-to-end tests — not performed.

## Blockers and risks

- The 17-file rebuild chain is a separate greenfield chain; it must not be mixed with `supabase/migrations/` or applied to the connected live project.
- SQL and Edge Function code have not been runtime-validated. The new migration 0017 and branch report need execution against a disposable Supabase/Postgres environment before staging.
- Leave approval is single-stage. Attachment-required types are deliberately rejected by the portal API. Annual entitlement is configurable metadata and is not enforced.
- The branch opening/closing report calculates planned open/close from the earliest/latest scheduled work shift; this is the greenfield behavior and differs from the historical fixed opening-time policy.
- Payroll formulas still need owner/accountant approval before enabling payroll actions for real use.
- Existing unrelated staged, unstaged, deleted, and untracked work remains in the worktree and was preserved.

## Exact next implementation step

Validate the complete `supabase/rebuild_migrations/` chain, especially 0012, 0013, and 0017, against a disposable local Supabase/Postgres environment; then run the three-account authorization and leave/hour acceptance tests there. Do not use the connected live project for this validation.
