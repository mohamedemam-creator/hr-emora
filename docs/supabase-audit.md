# Supabase Audit — Emora

**Audit date:** 2026-10-31  
**Scope:** Read-only comparison of this repository with the connected Supabase project `emora` (`atmkwfbfwpufhbsfjlzn`, PostgreSQL 17.11). Catalog and policy queries were read-only. No row contents, secrets, credentials, or environment files were read.

## Executive finding

The active application expects a substantially larger database/API than the connected live project exposes. Live has six `public` tables, one application RPC, and no deployed Edge Functions. The app has 59 statically named `app_*` RPC calls plus dynamically selected RPCs, and it uses tables/columns absent from live. The local migrations do not contain the app schema, and the live Supabase migration ledger relation is absent. Do not infer migration order or replay local SQL against production from this snapshot.

## 1. Live database inventory

### Public tables

All six tables have RLS enabled (not forced). Every listed column is live.

| Table | Columns |
|---|---|
| `companies` | `id uuid`, `name text`, `code text`, `created_at timestamptz` |
| `regions` | `id uuid`, `company_id uuid`, `name text`, `created_at timestamptz` |
| `branches` | `id uuid`, `company_id uuid`, `region_id uuid`, `name text`, `code text`, `address text`, `location geography`, `attendance_radius_m integer`, `minimum_gps_accuracy_m integer`, `created_at timestamptz` |
| `employees` | `id uuid`, `company_id uuid`, `branch_id uuid`, `user_id uuid`, `full_name text`, `email text`, `role text`, `device_id text`, `created_at timestamptz` |
| `shifts` | `id uuid`, `company_id uuid`, `name text`, `start_time time`, `end_time time`, `created_at timestamptz` |
| `attendance_logs` | `id uuid`, `company_id uuid`, `employee_id uuid`, `branch_id uuid`, `check_in timestamptz`, `check_out timestamptz`, `status text`, `created_at timestamptz` |

### Functions, policies, indexes and constraints

- Application RPC: `public.insert_branch_with_location(p_company_id uuid, p_region_id uuid, p_name text, p_code text, p_address text, p_latitude double precision, p_longitude double precision, p_radius integer, p_accuracy_limit integer DEFAULT 100) RETURNS public.branches`. It is `SECURITY DEFINER`, uses an empty `search_path`, and EXECUTE is granted to `service_role` only. Its live definition matches local migration 002.
- Other public routine returned by the catalog: `rls_auto_enable()` (event-trigger handler; not an app RPC).
- Policies: `companies` and `employees` each have permissive `SELECT USING (true)` and `INSERT WITH CHECK (true)` policies to `public`. The other four public tables have no policies.
- Indexes: primary-key indexes on all six tables, plus unique `companies_code_key`. No other public indexes were found.
- Constraints: primary keys on all six; unique `companies.code`; FKs: `regions.company_id → companies.id`; `branches.company_id → companies.id`, `branches.region_id → regions.id`; `employees.company_id → companies.id`, `employees.branch_id → branches.id`, `employees.user_id → auth.users.id`; `shifts.company_id → companies.id`; `attendance_logs.company_id → companies.id`, `employee_id → employees.id`, `branch_id → branches.id`.
- Supabase reports no deployed Edge Functions and no recorded migrations. Direct catalog inspection confirms `supabase_migrations.schema_migrations` does not exist. Recent Postgres logs include a missing-relation error for that ledger; logs are supporting evidence only.

## 2. Local repository inventory

- Active migration files: `supabase/migrations/002_app_bootstrap_support.sql` and `003_auth_bootstrap_review.sql`. No `001_time_attendance_core.sql` exists; 003 refers to it in comments. No declarative `supabase/schemas/` files were found.
- Migration 002 defines only `insert_branch_with_location`, including a service-role-only EXECUTE grant. Its live signature and body match.
- Migration 003 is marked “REVIEW ONLY” in comments, but contains executable GRANT statements for `app_current_access()` and `app_clear_password_change_flag()`. Both functions are absent from the live public catalog.
- Local Edge Function source: `bootstrap-company` and `create-branch`. The app also invokes `manage-employee-account`, `ios-web-attendance`, and `legacy-web-attendance`; no corresponding source directories were found here. None of the local functions is deployed in the connected project.
- The active app contains 59 distinct statically named `app_*` RPC calls, plus dynamically selected RPC calls; the live public catalog contains none of these app RPCs. Calls span auth/access, dashboard, attendance, employees, branches/regions, roles/permissions, leave, penalties, notifications, payroll, and shifts. Examples: `app_current_access`, `app_dashboard_summary`, `app_list_employees_v3`, `app_save_employee_v2`, `app_shift_workspace`, and dynamically selected `app_review_hour_permission_v2` / `app_review_hour_permission`.
- App/Edge Function code references `audit_logs`, `departments`, `employee_roles`, `job_titles`, `permissions`, `profiles`, `role_permissions`, and `roles`; none exists in live or has a local table definition in the inspected migration set.
- `bootstrap-company` expects employee columns `employee_code`, `phone`, `department_id`, and `job_title_id`; `create-branch` expects `employees.employment_status` and `regions.code`. These columns are absent live. The local migrations do not define them.
- Supabase includes generated `supabase/.temp/cli-latest`; excluded from active schema analysis.

## 3. Differences

| Object | Local | Live | Status |
|---|---|---|---|
| Base tables | No active table DDL in the two local migrations | Six bootstrap tables listed above | **Schema source missing locally** |
| Domain tables | App/Edge code depends on eight additional tables listed above; no local DDL found | Absent | **Missing** |
| Column contract | App expects `regions.code` and modern employee fields including `employee_code`, `employment_status`, `phone`, `department_id`, `job_title_id` | Those fields absent; live `employees` instead has `role` and `device_id` | **Conflicting/outdated** |
| App RPCs | 59 distinct statically named `app_*` calls plus dynamic RPC calls; migration 003 grants two names | No matching live app routines | **Missing API surface** |
| Branch helper RPC | Defined in migration 002; service-role-only | Same signature/body and privilege restriction present | **Aligned** |
| Edge Functions | Two local source functions; three other invoked names have no local source | Zero deployed functions | **Deployment drift** |
| Migration tracking | Local files numbered 002 and 003; referenced 001 missing | Ledger relation absent; migration list empty | **History unavailable/incomplete** |
| RLS / policies | No local table/policy DDL in active migration set | RLS on all six; broad public SELECT/INSERT policies on companies/employees | **Security mismatch; review required** |

## 4. Duplicate/conflicting files

- No duplicate filenames exist under `supabase/migrations/`; the two migration filenames are unique.
- No repeated active SQL table definitions were found. Migration 002 is consistent with the live helper function.
- Migration 003 is stale against this live catalog: its two GRANT targets do not exist. The comments claim several RPCs were confirmed live, but none of the 59 app RPCs exists in the inspected live public catalog.
- Backup files were excluded from active dependencies. Found examples include `app/dashboard/shifts/page_BACKUP_BEFORE_EXCEL_FIX.tsx`, several `page.tsx.backup-*` files, `app/dashboard/branches/page-backup.tsx`, report/sidebar backups, and dated `emora-backups/` snapshots. These are not migrations and must not be treated as current schema evidence.

## 5. Security concerns

1. **High: public employee/company reads.** Live grants `SELECT` and `INSERT` on these tables to `anon` and `authenticated`; combined with `public` policies using `true`, anonymous callers with Data API access can read all rows and insert rows. The employees table contains names and email fields. This needs an access-model review.
2. **High: broad table grants.** Catalog grants include all table privileges, including `TRUNCATE`, to `anon` and `authenticated` across the six public tables. RLS does not constrain TRUNCATE. Review the effective grants and exposed database paths urgently; do not assume RLS protects this privilege.
3. **Authorization model is inconsistent.** Four tables have RLS enabled but no policies, while the active UI expects RPC-based access control and those RPCs are absent. This can make client features fail while broad grants/policies create separate exposure.
4. **Definer helper is currently constrained.** `insert_branch_with_location` is security-definer but uses an empty search path and is executable only by `service_role`; no direct anon/authenticated EXECUTE was found.

## 6. Recommended recovery order

1. Preserve production data and take/verify a current recoverable backup before any future change.
2. Confirm this project reference is the intended production database and separately obtain the intended schema/migration history; current live catalog and migration ledger cannot establish chronology.
3. Reconstruct the canonical schema from a trusted live schema dump/release source and map every active app table, column, RPC signature, and Edge Function to it. Do not use backups as authority.
4. Reconcile RLS policies and table/function grants with the intended role/tenant access model, especially public employee/company reads and TRUNCATE grants.
5. Build and compare a clean migration sequence in an isolated development project/branch, including history tracking; do not replay 002/003 blindly.
6. Review and approve any production migration only after staging validation and a data-preserving rollback plan.

**Audit stopped here.** No migrations, writes, deployments, Git operations, or production data changes were performed.

