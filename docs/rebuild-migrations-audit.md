# Rebuild migration static audit

**Scope:** Local static review of `supabase/rebuild_migrations/0001`–`0016`, plus the required `0003a` security step and `0017` (which is present in the chain). No database query, migration execution, or live change was performed. The target project was not contacted for this audit.

## Findings

There are 41 `CREATE TABLE` definitions in 0001–0004 and one additional table in 0016. Files 0005–0015 define functions/triggers and APIs, not tables. The sole stored generated column was in 0004. Its original `date_trunc('month', period_start)::date` expression can resolve through a timezone-sensitive overload and caused PostgreSQL error `42P17: generation expression is not immutable`. The local expression is now `date_trunc('month', period_start::timestamp without time zone)::date`, whose timestamp overload is immutable. No other generated expressions were found.

No `CREATE POLICY` statements exist in the rebuild chain. This is a deliberate RPC-only access model: 0005 enables RLS and revokes direct browser-role table privileges, while authenticated callers receive narrowly scoped RPC EXECUTE grants. 0016 also locks its nonce table from direct access. Consequently, any frontend `.from()` table query would fail closed and must be replaced with an authorized RPC or server-side function. The active application database access found in this targeted scan is RPC/Edge Function based; `Array.from()` matches are not database queries.

### Table inventory

Required columns below are non-null columns without a default, excluding primary keys when they have generated UUID defaults. Important defaults and FK targets are summarized from the DDL; `now()`/`clock_timestamp()` timestamps are listed as timestamp defaults. `CASCADE`, `RESTRICT`, and `SET NULL` actions are part of the declared FK behavior and must be considered before future deletes.

| Migration | Table | Required columns | Key defaults | FK targets |
|---|---|---|---|---|
| 0001 | companies | name, code | status `active`; timezone `Africa/Cairo`; timestamps `now()` | — |
| 0001 | profiles | user_id, full_name | timestamps `now()` | auth.users |
| 0001 | platform_admins | user_id, grant_reason | granted_at `now()` | auth.users (user, grantor) |
| 0001 | company_memberships | company_id, user_id | status `active`; timestamps `now()` | companies, auth.users, employees (composite added later in same file) |
| 0001 | user_company_context | user_id, company_id | updated_at `now()` | auth.users, company_memberships (company,user) |
| 0001 | platform_admin_context | user_id | updated_at `now()` | platform_admins, companies (nullable) |
| 0001 | regions | company_id, name, code | active true; timestamps `now()` | companies, employees (manager, composite added later) |
| 0001 | branches | company_id, name, code | attendance radius 100; GPS accuracy 100; active true; timestamps `now()` | companies, regions (same company; restrict) |
| 0001 | departments | company_id, name, code | active true; timestamps `now()` | companies |
| 0001 | permissions | code, module, name | created_at `now()` | — |
| 0001 | roles | company_id, name, code | system false; active true; timestamps `now()` | companies |
| 0001 | role_permissions | role_id, permission_id | scope `company` | roles, permissions |
| 0001 | job_titles | company_id, name, code | active true; timestamps `now()` | companies, departments, roles (nullable scoped FKs) |
| 0001 | employees | company_id, employee_code, full_name | status active; salary values 0; daily hours 9; must-change false; login true; timestamps `now()` | companies, auth.users, branches, departments, job_titles, employees (manager; same-company composite FKs) |
| 0001 | employee_roles | employee_id, role_id | assigned_at `now()` | employees, roles; assigned_by employees |
| 0001 | employee_branch_assignments | employee_id, branch_id, company_id | starts_on `current_date`; assigned_at `now()` | employees, branches (same company) |
| 0001 | employee_region_assignments | employee_id, region_id, company_id | starts_on `current_date`; assigned_at `now()` | employees, regions (same company) |
| 0001 | employee_scope_assignments | employee_id, role_id, company_id, scope_level | created_at `now()` | employees, employee_roles (employee,role); target validity guarded by trigger in 0005 |
| 0002 | shift_templates | company_id, name, code, start_time, end_time | grace/break 0; paid break and active true; timestamps `now()` | companies, branches (same company; restrict) |
| 0002 | shift_assignments | company_id, employee_id, branch_id, shift_date | day work; status draft; timestamps `now()` | companies, employees, branches, shift_templates, auth.users |
| 0002 | attendance_sessions | company_id, employee_id, branch_id, work_date | source web; status present; minute counters 0; timestamps `now()` | companies, employees, branches, shift_assignments; adjusted_by employees |
| 0002 | geofence_events | company_id, employee_id, branch_id | detected/created `now()`; accepted false | employees, branches, attendance_sessions (same company) |
| 0002 | web_attendance_exceptions | company_id, employee_id | enabled false; timestamps `now()` | employees (same company), auth.users |
| 0002 | shift_change_requests | company_id, employee_id, branch_id, shift_date, request_type | requested_at/created_at `now()`; status pending | employees, branches, shift_assignments, shift_templates, leave_types (added in 0003) |
| 0003 | leave_types | company_id, name, code | paid false; attachment false; active true | companies |
| 0003 | approval_workflow_definitions | company_id, request_type, name | active true; timestamps `now()` | companies |
| 0003 | request_approval_stages | company_id, workflow_definition_id, stage_order, approver_kind, scope_level | required true | workflow definitions, roles, employees (same company) |
| 0003 | request_approval_workflows | company_id, request_type, request_id, employee_id | current stage branch/order 1; status pending; timestamps `now()` | companies, workflow definitions, employees, branches, regions; reviewer employees |
| 0003 | request_approval_actions | company_id, request_workflow_id, stage_id, actor_employee_id, decision | acted_at `now()` | workflows, stages, employees (same company) |
| 0003 | leave_requests | company_id, employee_id, leave_type_id, starts_on, ends_on, requested_days | status pending; timestamps `now()` | employees, leave_types; reviewer employees |
| 0003 | employee_hour_permissions | company_id, employee_id, permission_date, permission_type, requested_minutes | status pending; timestamps `now()` | employees; reviewer employees |
| 0003 | employee_penalties | company_id, employee_id, penalty_type, title, effective_date | amounts/days 0; status approved; timestamps `now()` | employees (employee, creator, canceller) |
| 0003 | penalty_approval_requests | company_id, employee_id, penalty_type, title, effective_date | amounts/days 0; status pending; timestamps `now()` | employees, branches, regions, employee_penalties (same-company composites) |
| 0003 | notifications | company_id, recipient_employee_id, notification_type, title, body | created_at `now()` | employees, auth.users |
| 0004 | payroll_settings | company_id | overtime true; divisor 30; absence/unpaid deductions true; late/early false; multiplier 1.5; currency EGP; updated_at `now()` | companies, auth.users |
| 0004 | payroll_cycles | company_id, period_start, period_end, label | month_start generated; status draft; timestamps `now()` | companies, employees (creator/calculator/reviewer/closer/reopener) |
| 0004 | payroll_items | company_id, cycle_id, employee_id | all numeric snapshot/amount counters default 0; daily hours 9; updated_at `now()` | payroll_cycles, employees, branches (same company) |
| 0004 | ios_web_devices | company_id, employee_id, browser_id | status active; timestamps `now()` | employees, auth.users |
| 0004 | ios_web_device_requests | company_id, employee_id, request_code | status pending; requested/created `now()` | employees |
| 0004 | mobile_devices | company_id, employee_id, device_id | status active; timestamps `now()` | employees |
| 0004 | audit_logs | action, category, status | actor_platform_admin false; context `{}`; occurred_at `clock_timestamp()` | auth.users, company_memberships, employees, companies |
| 0016 | ios_web_signature_nonces | company_id, browser_id, nonce | used_at `clock_timestamp()` | companies |

### RLS, function dependencies, and access model

| File(s) | Verified static behavior | Assessment |
|---|---|---|
| 0001–0002 | Create base tables but do not enable RLS themselves. | On a truly empty project, a security baseline must follow these files before any untrusted application use. The separately located `supabase/migrations/0002a_security_baseline.sql` is not automatically part of lexical `rebuild_migrations` ordering. |
| 0003 | Creates request/approval tables; no RLS or grants in that file. | Exposure window unless the security baseline was already applied. New local `0003a_security_lockdown_requests.sql` enables RLS and revokes public/anon/authenticated privileges for those ten tables. |
| 0004 | Creates seven payroll/device/audit tables; local tail now enables RLS and revokes public/anon/authenticated table privileges. | Closes the 0004-to-0005 exposure window. |
| 0005 | Defines profile sync, employee/membership/scope triggers, company helpers, permission helpers, `app_current_access()`, and a dynamic RLS/grant sweep. The sweep enables RLS and grants table access to `service_role`, while revoking direct grants from browser roles. | Helper functions/triggers are defined before dependent APIs in later migrations. No row policies are created; direct browser table access is intentionally unavailable. `ENABLE` does not remove an existing `FORCE`; migration 0002a forces only tables present when it ran. |
| 0006 | Defines service-only `service_bootstrap_company(uuid,text,text,text,text,text)` and seeds permission catalog. | Requires tables from 0001, 0003, 0004 and helpers from 0005. EXECUTE is restricted to service_role; the caller identity is passed by the Edge Function and must be validated there and again by the function. |
| 0007–0015 | Authenticated RPCs generally revoke public/anon EXECUTE and grant authenticated EXECUTE; functions use `SECURITY DEFINER` and empty `search_path`. | Authorization depends on their function-body checks (`auth.uid()`, company context, permission and scope helpers), not RLS policies. Static review is not runtime proof for every branch/permission case. |
| 0016 | Creates nonce table after 0005, enables RLS, revokes all direct table rights including service_role; exposes nonce handling via security-definer RPCs. | Intentional RPC-only exception; table owner/function owner must be able to execute the controlled internal operation. No FORCE RLS is set. |
| 0017 | Adds leave-type management RPCs. | Present despite the requested 0001–0016 range; README lists it as chain step 17 and it must be included after 0013/0005. |

The Auth profile trigger in 0005 is created only after `profiles` exists (0001). `app_current_access()` and its helpers precede API consumers (0006 onward). This ordering is sound by file dependency. The bootstrap RPC additionally depends on `leave_types`, payroll settings, audit records, role/permission structures, and employee tables. PostgreSQL extension PostGIS must be available and installed in `extensions` before branch geography declarations/functions in 0001/0005.

## Migration disposition

“Clean” below means no specific static blocker was found, not that PostgreSQL execution or end-to-end authorization was proven. None of these files can be certified 100% deploy-ready without applying the complete chain to a disposable compatible Supabase/Postgres environment and exercising the APIs.

| Migration | Disposition | Required action / dependency |
|---|---|---|
| 0001 | Static review: no identified syntax blocker | Requires Auth schema, UUID support, PostGIS in `extensions`; add baseline immediately after base tables. |
| 0002 | Static review: no identified syntax blocker | Depends on 0001 and `leave_types` FK is added by 0003. |
| 0003 | Static review: duplicate `reviewed_at` issue is absent; definition is nullable `timestamptz` | If already recorded live, do not re-run. On a new chain, follow immediately with 0003a (or an equivalent baseline). |
| 0003a (supplemental) | Local fix: RLS/revoke lockdown for 0003 tables | Removed the schema-wide sequence revoke because it would affect unrelated public sequences; these UUID-backed tables need no sequences. Verify exact live history before applying. |
| 0004 | **Previously blocked** by immutable generated expression; corrected locally and table lockdown added | Keep corrected timestamp-without-time-zone cast. Requires 0001/0003. Prior live failure was reported as 42P17; read-only verify whether any objects/history were partially recorded before retry. |
| 0005 | No identified ordering blocker in static inspection | Requires all tables through 0004. Review `DROP TRIGGER IF EXISTS` and `CREATE OR REPLACE` as idempotent trigger/function replacement, not table/data deletion. |
| 0006 | No identified static blocker | Requires 0005 helpers and tables from 0001/0003/0004. |
| 0007 | No identified static blocker | Requires employee, membership, role, permission and bootstrap foundations. |
| 0008 | No identified static blocker | Requires 0005 authorization helpers and organization tables. |
| 0009 | No identified static blocker | Requires attendance schema and 0005/0007–0008 foundations. |
| 0010 | No identified static blocker | Requires shifts/attendance, authorization and organization APIs. |
| 0011 | No identified static blocker | Requires notifications table and authorization helpers. |
| 0012 | No identified static blocker | Requires attendance/shifts and report authorization. |
| 0013 | No identified static blocker | Requires leave/hour tables and approval/notification dependencies. |
| 0014 | No identified static blocker | Requires penalties/request tables and audit/notification helpers. |
| 0015 | No identified static blocker | Requires payroll schema, attendance, leave and penalty data. Payroll formulas still need business-owner validation (README notes this). |
| 0016 | No identified static blocker | Requires device tables and prior authorization helpers; nonce table is explicitly locked. |
| 0017 | No identified static blocker | Requires leave_types and permission/audit helpers. |

### Recommended execution order

For a new empty environment: `0001 → 0002 → security baseline (the reviewed 0002a file, explicitly included) → 0003 → 0003a → corrected 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010 → 0011 → 0012 → 0013 → 0014 → 0015 → 0016 → 0017`.

For the known project history where 0001–0003 may already be recorded: do not rerun them. First perform a read-only check of migration history and objects after the failed 0004 attempt; then apply only the missing request-table lockdown if not already present, followed by corrected 0004, and continue sequentially 0005–0017 with verification after each. This is an order recommendation only; no live action was taken or authorized by this audit.

## Fixes made locally

1. `0004_payroll_devices_audit.sql`: changed the stored month expression to use `period_start::timestamp without time zone`; added RLS enablement and direct browser-role revokes for all seven newly created tables so the one-migration-at-a-time window is closed.
2. `0003a_security_lockdown_requests.sql`: retained the per-table lockdown and removed `REVOKE ... ON ALL SEQUENCES IN SCHEMA public`, which was broader than this migration's tables and could affect unrelated existing public objects. No sequence-backed columns are declared in 0003.

## Validation limits and remaining risks

- Static search/review only. Neither `psql` nor the Supabase CLI was available in the shell; no SQL parser, PostgreSQL execution, migration transaction, or runtime authorization test was run.
- `0003a_security_lockdown_requests.sql` is a local supplemental filename, not a standard timestamped Supabase CLI migration name. The rebuild directory is separate from the CLI migration directory; confirm the approved runner accepts this naming before use, or assign it a supported version in the reviewed migration plan.
- Several foundational files use `CREATE TABLE IF NOT EXISTS` but also unguarded `ALTER TABLE ... ADD CONSTRAINT`. Treat the chain as one-time ordered migrations, not a safely repeatable script. Do not retry a failed migration until its transaction/history and partial objects have been read-only verified.
- RLS has no row policies in this architecture. Direct `.from()` queries will fail; ensure future frontend code continues through individually authorized RPCs/Edge Functions.
- SECURITY DEFINER correctness still depends on function ownership and role attributes in the target project. Confirm the migration owner can access protected rows as intended, and service_role remains server-side only. The local SQL review cannot establish live owners/grants.
- Migration 0002a’s `FORCE RLS` applies to its target set at execution time. Later tables get `ENABLE` from 0003a/0004 and the 0005 sweep, but are not forced. This is intentional for owner-executed SECURITY DEFINER functions, but the effective owner/BYPASSRLS behavior must be verified in staging.
- `ON DELETE CASCADE` on tenant-owned records is declared in the schema. It is not executed by these migrations but would remove dependent rows if a parent were later deleted.
- Migration 0005 sweeps every public table (except `spatial_ref_sys`) and every public sequence, revoking browser-role access and granting `service_role` broad access. That is consistent only if the target schema contains exclusively intended Emora objects; otherwise scope the sweep to the chain's owned objects before execution.
- The prior 0004 failure and whether any DDL/history was partially committed were not rechecked against production here. Do not infer that production matches local files.
