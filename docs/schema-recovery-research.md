# Emora Schema Recovery Research

**Research date:** 2026-10-31  
**Mode:** Read-only. No database write/query execution, Git change, migration, deployment, or file edit was performed other than creating this report. Secret and environment files were excluded and not read.

## Finding

**No trustworthy complete historical schema can be reconstructed from the repository evidence found.** The strongest historical artifact is a 100-row CSV export of PostgreSQL function definitions. It is useful evidence for part of the historical backend, but it contains no table or column DDL, constraints, indexes, RLS policies, or grants. The only local migration with a database definition is a single branch helper function. Neither is a complete schema source.

Use the current live catalog as the authority for the database that exists now. To establish an intended earlier schema, the most reliable candidate is a verified Supabase schema-only backup/export from the relevant production date, corroborated against its backup timestamp, project reference, and application release. No such full export was found here.

## Evidence inventory and confidence

| Source | Evidence | Assessment |
|---|---|---|
| `Supabase Snippet Untitled query (8).csv` | 321,431 bytes; SHA-256 `24B79D09EDA870FEBC8A51D3AE2914A9D8B59BAE3E93723AC3ADBA1B2CA4C67E`. Columns are `function_name` and `function_definition`; 100 rows have `CREATE OR REPLACE FUNCTION` headers and closing dollar-quote terminators. | **Medium** for historical function bodies; **low** as a source of truth. It is function-only, has no captured query, project ref, or database snapshot timestamp, and is named like an untitled query export. |
| `supabase/migrations/002_app_bootstrap_support.sql` | 1,292 bytes; SHA-256 `7DC84F416490271D00D61B2429ABA6C4FEBAD4419BEB51E2E7B996719961F3C1`. Defines `public.insert_branch_with_location` and revokes execution from public/anon/authenticated, granting it to `service_role`. | **High** for this one function only. It is in Git history and its function definition matches live. It defines no tables or other application backend objects. |
| `supabase/migrations/003_auth_bootstrap_review.sql` | 1,443 bytes; SHA-256 `D20B3816F2DF47DCE3988C17EAA1FDEC28BBC30269B70C3F94FBDDC898B45241`. Contains review comments plus executable grants to two `app_*` functions. | **Low** as schema evidence. It is not tracked in any inspected branch and its two grant targets are absent from the live catalog. |
| `supabase/.temp/cli-latest` | 8 bytes; value `v2.121.0`; SHA-256 `268F7AE709209256D49C0D4C3E21B95EF2B87DE338C074932E790EFFC7A728C0`. | **Low**; generated CLI version metadata, not schema or migration history. |
| Backup folders and historical app snapshots | Searched backup and snapshot source files for schema DDL. No table/function/policy/index/trigger DDL was found there. Files are application UI/source snapshots. | **Low** for database recovery. Useful only for historical app dependencies. |
| Git history and branches | 15 commits; branches `main` and `origin/main` point at `9865119` (2026-10-25); `cursor/fix-vercel-next16-build` points at `baa840b` (2026-10-21). Schema-related history found only in initial launch commit `bb45e65` (2026-10-20): the CSV export and migration 002. | **High** that the searched branch history contains no other tracked SQL/CSV schema source; **low** as proof of production state. Migration 003 is working-tree-only, not branch history. |

No other local `.sql` or `.csv` files were found outside generated/dependency/build folders. No `supabase/config.toml` or declarative `supabase/schemas/` directory was found. The tracked Supabase CLI metadata does not supply migration history.

## Historical export compared with live and active app

- The CSV contains 100 function definitions and no `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`, RLS-enable, `GRANT`, `REVOKE`, `CREATE INDEX`, or `CREATE TRIGGER` statements.
- **53 of the active app's 59 statically named `app_*` RPC calls** have a same-name definition in the CSV. Six current calls have no same-name CSV row: `app_shift_all_accessible_workspace`, `app_shift_all_scope_access`, `app_shift_edit_policy`, `app_shift_workspace`, `app_submit_leave_request`, and `app_submit_penalty_for_approval`. Name matches do not prove signature or behavior compatibility. Dynamic app RPC calls also need independent signature review.
- SQL references in the export include 32 distinct `public.*` relation-like names in `FROM`/`JOIN`/`INTO`/related clauses. Four are among the six current live tables (`branches`, `companies`, `employees`, `regions`); 28 other referenced names are not live tables. This is a lexical dependency inventory, not a schema definition; unqualified references and dynamic SQL may be missed.
- The export's historical functions depend on a broader domain including attendance sessions, employee branch/region assignments, roles/permissions, leave, payroll, penalties, notifications, shift assignments/templates, geofence/device tables, and audit logs. No local SQL defines those tables.
- The active application also expects modern fields absent from live, including `regions.code` and employee fields such as `employee_code`, `employment_status`, `phone`, `department_id`, and `job_title_id`. The live catalog currently has only the six tables documented in `docs/supabase-audit.md`; only `insert_branch_with_location` from the application-facing RPC surface is present.
- Migration 003's grants for `app_current_access()` and `app_clear_password_change_flag()` therefore do not establish that those definitions existed in any branch or on live. The comments in that file are claims, not independent historical evidence.

## Duplicate filenames with different contents

SHA-256 values below are full hashes. These are literal basename collisions in source/snapshot files; many are expected Next.js route filenames in different directories and are not duplicate schema files.

**`index.ts`**

- `supabase/functions/create-branch/index.ts` — 4,725 bytes — `EB2C5CC32DDB849C481B22996F820C717D4F5192DFBD2D7B2B4A300CCF008FB2`
- `supabase/functions/bootstrap-company/index.ts` — 4,619 bytes — `8B6A43CCC574FA85D4A24BB90855B9D544DC4492E1A4829C1FC399D1FADAA647`

**`layout.tsx`**

- `app/layout.tsx` — 436 bytes — `D820DE53629E26EFA92A8020FA4A483B566F31C4650F4D20EF2B933E81F63943`
- `app/dashboard/layout.tsx` — 352 bytes — `94B43C92E6EA12324C837E1ED7620F16274515CCE3CC6F643C52E3A9BCBFF2C1`

**`page.tsx`**

- `app/page.tsx` — 2,678 bytes — `8609198FEC3002638E1DEA23F4085BA0E13BF2DAC04D378D9B22D71FD8D587AE`
- `app/setup/page.tsx` — 302 bytes — `AAB8B65D12833F2970F8A1B6CABB8758336ED36552971AF9AF335A21A41B8F9F`
- `app/change-password/page.tsx` — 3,156 bytes — `E5A2863668FF635D84BA7A2A6728114FFE74446D9EEA8A124BCD3C8ADBF22FD2`
- `app/portal/page.tsx` — 37,404 bytes — `AD92C124DD4A7639D8C8F3F91966A609256E100C47C702F6EBEFFCD809D19078`
- `app/dashboard/page.tsx` — 15,104 bytes — `4A1316862E3B53F0AB902B08D109DF6BE68DD43F2D02EC42EA22E2C28DC5DA64`
- `app/login/page.tsx` — 5,937 bytes — `48D70EF3C76358597F294E7F71A935801D8020D74C9E2C51D69CA61FC3E832F5`
- `app/dashboard/attendance/page.tsx` — 22,276 bytes — `E68894331C207A4A291937A0FB9D6A210EDEED5A4402962E87FDEEB53C89D0E2`
- `backup-hour-permissions-ui/app/portal/page.tsx` — 23,882 bytes — `386015F1219DB9274D9605B01C9449958D9AB2B188BF77C766B9B78752EF9B9C`
- `app/dashboard/leaves/page.tsx` — 8,183 bytes — `6317D4CB8327D5EAF8F31C573AD5D724BA52401C53C78C15D9EBBFF40C1FB1AC`
- `emora-backups/report-date-defaults-2026-09-04T13-50-15-808Z/app/dashboard/reports/page.tsx` — 14,412 bytes — `45D18BB1584F9F08260DDDED4C9FF03E04C7A8B9169719A15BB3024A13D630E2`
- `emora-backups/report-date-defaults-2026-09-04T13-50-15-808Z/app/dashboard/penalties/page.tsx` — 24,973 bytes — `9733E83FA31C83331CAE80A084C989A3EBEE0590DF5E6329A905DCC7E5EB03EE`
- `app/dashboard/shifts/page.tsx` — 37,345 bytes — `F441D037845175E0E16FC11D25C1E8B355B4953CA7C01BE59CEB3CCED06A1D86`
- `app/dashboard/employees/page.tsx` — 29,203 bytes — `8D878FDB1CF1D6E5B900F4E9E16164E77DC126E1145C099E3304F5A7CCD5A743`
- `app/dashboard/organization/page.tsx` — 11,735 bytes — `51FAE6FC514729D0CF10F158CD93E565B00ABF64BBE121E17BA74B6BA5A57D69`
- `app/dashboard/notifications/page.tsx` — 2,354 bytes — `8E883889937F165C438C9C237C3415B09274397AC724B64455D666F8D970C833`
- `app/dashboard/penalties/page.tsx` — 25,262 bytes — `D8B68909A724BBA6377B0A19EE6B235788479E18BDA1CCBA9205A8E96959308D`
- `app/dashboard/reports/page.tsx` — 14,726 bytes — `9E89FDFF05772F6BD6E8503E0A7F0989248C96DE7ED8D11BD44237AA1355628A`
- `app/dashboard/payroll/page.tsx` — 29,586 bytes — `7F7896C1D5F4A7A99A9B18F088F67FEAF987276AB94236512EB1CA33D1A094CB`
- `app/dashboard/settings/page.tsx` — 357 bytes — `803227B13DA1A9B7BFB89D237809527DD0240942A0180287BCF33FF91E5A84EB`
- `app/dashboard/roles/page.tsx` — 9,864 bytes — `BBD8CE5DBD77BDE76A70B7BEC15B0760C011625B9A21C8F5A25380D5675D7E19`
- `app/dashboard/permissions/page.tsx` — 9,607 bytes — `AB37AEF50DD1A9EB61EB74E10316629540EF2253F546581AA54C09CE74DE3433`
- `app/dashboard/branches/page.tsx` — 41,069 bytes — `DC6AB079D5B3E5201EF0F3D08F008F828BEBFCB37BF888381DAF4BD2BC0862E7`
- `app/dashboard/regions/page.tsx` — 9,214 bytes — `8DF4E54A1715F4830845D0FA2ACF1F706DB0DB7E1B7E9546D4552A2EC524EF29`

**`proxy.ts`**

- `proxy.ts` — 728 bytes — `BFF05A59A97AD7B8DC86DD34E450A45389EDD6FD992D94D3EC2B9322DBD170B3`
- `lib/supabase/proxy.ts` — 812 bytes — `0BAD8449C3CAA8D5A0C8B609116D6243D1121803C5464CD8313A14B7CC6F5502`

**`sidebar.tsx`**

- `components/sidebar.tsx` — 6,262 bytes — `4A7DCDFBD87BD7BE5A6D496FDDC0BDB641AB6B6B29A8A7249C2F3FF76A983AB1`
- `backup-hour-permissions-ui/components/sidebar.tsx` — 5,646 bytes — `EF8D6D3266A90DFA1DD070B60F2B1CF9A5EE66F93A21A0CAFC59B649B62B3897`

Backup files with suffixes such as `page.tsx.backup-*`, `page-backup.tsx`, and the dated `emora-backups/` files were treated as snapshots, not active schema sources. Their DDL search found no database definitions. No duplicate `.sql` or `.csv` basenames were found.

## Unresolved gaps

- No project reference or extraction query accompanies the function CSV, so its exact database and export time are unverified.
- No full schema-only dump, complete migration series, historical backup manifest, or authoritative pre-drift application release is present.
- Routine names do not prove argument compatibility; current dynamic RPC choices and exact signatures still need a separate contract comparison if this research proceeds.
- The live migration ledger is absent, so Git commit order cannot establish which schema changes reached production.

## Recommended source of truth

For **current** state, trust the connected live PostgreSQL catalog inspected in `docs/supabase-audit.md`. For the **intended historical** state, obtain and verify the Supabase backup/schema-only export from the release date that matches the application version. Treat the CSV as a medium-confidence historical function-body reference, migration 002 as a high-confidence single-function definition, and all backups as supporting application evidence only. If no full backup/export exists, the evidence is insufficient to safely recreate the complete intended schema without further authoritative source material.

