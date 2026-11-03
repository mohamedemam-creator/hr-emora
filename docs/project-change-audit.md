# Emora project change audit

Read-only audit based on `git status`, staged/unstaged diffs, recent history, and SHA-256 comparison against `..\demo-backup-before-codex`. `.env.local` was not opened. No Git state or project source was changed; this report is the requested output.

## Scope and baseline

- Current Git state: one file has both staged and unstaged edits; 16 other tracked paths modified; one tracked image deleted; eight ordinary untracked paths plus the untracked `.agents/` skill tree. Staged change: `app/change-password/page.tsx` (3 insertions, 4 deletions); unstaged change to that file is separate.
- Backup comparison: all current non-generated files with matching backup paths had identical hashes; no current non-generated path was absent from the backup in the bounded comparison. This means the working tree appears to match the named backup on inspected files, while differing from the Git index/HEAD. The backup is a comparison point, not an authority.
- Recent committed history: Oct 21 Next 16 build/router work moved middleware to `proxy.ts`, added auth callback/setup form and Suspense; Oct 22 login fallback/router changes; Oct 22 Supabase client packages; Oct 25 README changes. Commit messages explain these committed changes, but do not explain the current uncommitted working-tree edits.
- `git diff` emitted line-ending warnings for several edited text files. No code change is implied by those warnings, but line-ending normalization should be considered when reviewing diffs.

## Application code

| File path | Change type | Main change | Assessment | Application impact |
|---|---|---|---|---|
| `app/login/page.tsx` | Modified, unstaged | Reworks login flow: validates user, routes must-change-password, loads `app_current_access`, formats errors, removes metadata fallback and blocks on missing RPC/error | Intentional hardening; backend dependency means incomplete until live RPC contract exists | Auth routing and every login; errors now stop login instead of permissive fallback |
| `app/setup/setup-form.tsx` | Modified, unstaged | Reworks setup form submission/error handling and bootstrap response flow | Intentional, but incomplete against current live schema/Edge deployment evidence | Initial tenant/admin creation and first sign-in |
| `app/portal/page.tsx` | Modified, unstaged | Small portal behavior changes | Unclear without commit rationale; compare against prior behavior before reusing | Employee portal workflows |
| `components/dashboard-access-guard.tsx` | Modified, unstaged | Removes broader access helper usage and adjusts guard logic | Risky/unclear because route authorization is changed locally | Dashboard access boundary and redirects |
| `lib/app-access.ts` | Untracked | Centralizes access shape, role permission checks, and error formatting | Intentional-looking new shared utility; not committed or independently validated | Login, access guards, password-change routing |
| `app/change-password/page.tsx` | Modified staged and unstaged | Staged removes helper import; unstaged introduces inline permission-based route decision | Incomplete/unclear: split staged+working changes create a composite behavior; role code handling differs from shared helper | Password-change completion and route destination |
| `backup-hour-permissions-ui/components/sidebar.tsx` | Modified, unstaged | One-line UI/access change in a backup-named tree | Unclear; backup copy is not active app code | No active route effect unless imported elsewhere; preserve as historical artifact |
| `emora-backups/report-date-defaults-2026-09-04T13-50-15-808Z/app/dashboard/penalties/page.tsx` | Modified, unstaged | One-line change in dated backup snapshot | Unclear and likely non-active; exclude from application behavior pending reference check | No effect presumed on active route |
| `emora-backups/report-date-defaults-2026-09-04T13-50-15-808Z/app/dashboard/reports/page.tsx` | Modified, unstaged | Small report default change in dated backup snapshot | Unclear/non-active | No effect presumed on active route |

## Database and Supabase

| File path | Change type | Main change | Assessment | Application impact |
|---|---|---|---|---|
| `supabase/functions/bootstrap-company/index.ts` | Modified, unstaged | Uses profile upsert by `user_id`; adds public error sanitization | Intentional-looking retry/error improvement; incomplete until deployed and tables verified | Setup Edge Function; duplicate profile creation behavior and error disclosure |
| `supabase/migrations/003_auth_bootstrap_review.sql` | Untracked | Transaction with `GRANT EXECUTE` for two RPCs; file labels itself “REVIEW ONLY” and “do not execute until verified” | Risky if treated as a migration: it contains executable DDL/grants despite warning. Not run by this audit | Could alter RPC exposure if someone applies it; only safe after signature/role/RLS review |
| `supabase/functions/create-branch/index.ts`, `supabase/migrations/002_app_bootstrap_support.sql` | Unchanged tracked/local files | Existing function/migration source remains in repository | Historical/local only; earlier audit found no deployed Edge Function set and a divergent live schema | Branch creation is not established as deployable/active |
| `docs/supabase-audit.md`, `docs/schema-recovery-research.md`, `docs/backend-contract-audit.md` | Untracked reports | Prior database and backend investigations | Useful evidence, but untracked and not versioned; audit statements remain time-bound | Guide rebuilding; not executable dependencies |
| `Supabase Snippet Untitled query (8).csv` | No working-tree change identified | Historical SQL function export | Not authoritative for live schema; prior research found function bodies but not full DDL/RLS/grants | Potential contract evidence only |

## Authentication and authorization

The principal current auth changes are in `app/login/page.tsx`, `app/change-password/page.tsx`, `components/dashboard-access-guard.tsx`, `lib/app-access.ts`, `app/setup/setup-form.tsx`, and `supabase/functions/bootstrap-company/index.ts`. They change who is routed to `/dashboard` vs `/portal`, how missing `app_current_access` is handled, and how initial users/profiles are set up. This is a high-impact cluster: shared helper and inline password route checks should be reconciled, and the RPC and Edge deployment/schema must be verified before relying on them. Current code requires access RPC success for normal login; prior live audit reported the RPC absent.

## UI and styling

| File path | Change type | Main change | Assessment | Application impact |
|---|---|---|---|---|
| `app/globals.css` | Modified, unstaged | Small CSS adjustments | Likely intentional presentation tweak; rationale unclear | Global styling across app |
| `components/logo.tsx` | Modified, unstaged | Logo/brand markup or presentation changed | Intentional-looking; verify asset availability | Branding wherever component is used |
| `components/sidebar.tsx` | Modified, unstaged | Small navigation/sidebar change | Unclear; route visibility can affect discoverability, not server authorization | Dashboard navigation |
| `public/emora-brand-reference.png` | Deleted | Removes 1.38 MB image tracked by Git | Unclear whether obsolete; verify no references before rebuild | Any image/import path referencing it will break |
| `preview/index.html` | Modified, unstaged | Preview metadata/markup change | Likely presentation-only | Static preview only |

## Configuration and deployment

| File path | Change type | Main change | Assessment | Application impact |
|---|---|---|---|---|
| `next-env.d.ts` | Modified, unstaged | Next generated type reference changed | Generated; likely incidental, should be regenerated only through normal build flow after review | Type checking/tooling |
| `skills-lock.json` | Untracked | Skill/tooling lock metadata | Generated/tooling; not runtime application code | Agent workflow only |
| `.agents/` | Untracked tree | Installed agent skill files | Generated/tooling; inspect provenance before committing; exclude from runtime rebuild | Agent workflow only |
| `AGENTS.md` | Untracked | New repository instructions | Intentional-looking but untracked; review policies before keeping | Agent behavior, not app runtime |
| `database-usage.txt` | Untracked | Database notes/usage artifact | Unclear provenance and maintenance status | Operational reference only |

## Documentation and generated files

The three untracked audit reports are newly created project artifacts. `next-env.d.ts`, `skills-lock.json`, `.agents/`, and `tsconfig.tsbuildinfo` (the latter has committed history changes, not current status) are generated/tooling-related. Dated `emora-backups/` and `backup-hour-permissions-ui/` content should not be included in active application behavior without confirming imports/build inclusion. No `package.json`, lockfile, Next config, Wrangler config, or active route tree currently appears in the working-tree status, although committed history shows package changes on Oct 22 and Next routing changes Oct 21.

## High-risk changes requiring human review before rebuilding

1. Confirm the real live `app_current_access` function and its grants/return shape; current login now blocks when it is missing, and previous audit evidence reported it absent.
2. Review staged plus unstaged `app/change-password/page.tsx` as one combined diff and reconcile its inline role logic with `lib/app-access.ts` and the dashboard guard.
3. Do not apply `003_auth_bootstrap_review.sql` until live signatures and least-privilege execution grants are confirmed; its warning does not make the `GRANT` statements inert.
4. Verify `bootstrap-company` profile upsert assumptions and required live tables, then confirm the function is actually deployed; local source alone is not production behavior.
5. Verify whether deleting `public/emora-brand-reference.png` breaks an active reference, and keep backup snapshots out of route/build inputs unless intentionally restored.
