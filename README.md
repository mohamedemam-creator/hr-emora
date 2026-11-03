# Emora HR

Emora HR is an Arabic-first, RTL-ready workforce management platform built for everyday people operations. The application brings company administration and employee self-service together across organization management, attendance, shifts, leave, and operational reporting.

> **Project status:** Active development. The repository includes the Next.js application and a greenfield Supabase migration chain. Review the implementation and environment-specific backend setup before treating any workflow as production-ready.

## Product areas

- **Organization:** companies, branches, departments, employees, and company-scoped roles.
- **Attendance:** location-aware check-in and check-out, attendance history, and administrative review.
- **Workforce operations:** shift scheduling, leave and hour-permission requests, and notifications.
- **Administration:** payroll workflows, device management, and workforce reports.
- **Identity and access:** Supabase Auth with separate platform and company authorization contexts.

Availability depends on the configured Supabase schema and Edge Functions. The interface may contain workflows that still require backend setup or runtime verification.

## Technology

- Next.js and React with TypeScript
- Supabase Auth and PostgreSQL
- Supabase SQL migrations, RPCs, and Edge Functions
- Browser geolocation for attendance workflows
- Arabic-first RTL interface

## Run locally

### Prerequisites

- Node.js and npm
- A Supabase project configured for the Emora schema

### Install and configure

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key for your development environment. Keep `.env.local`, service-role credentials, and other private values out of Git.

### Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local checks

```bash
npm run typecheck
npm run build
```

## Supabase backend

The greenfield schema sequence is maintained in [`supabase/rebuild_migrations/`](supabase/rebuild_migrations/). Read its README and reconcile the target database's migration history before applying SQL. Do not mix the separate historical files under `supabase/migrations/` into a fresh deployment sequence.

Edge Function source is under [`supabase/functions/`](supabase/functions/). Configure the required server-side secrets through Supabase's secret management. Never expose a service-role key in browser code or commit it to the repository.

## Deploy

Vercel is the deployment target. Connect the repository to Vercel, configure the required `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` environment variables for the relevant deployment environments, and use the standard Next.js build. Apply reviewed database migrations and deploy required Supabase Edge Functions separately through the approved backend workflow.

## Project links

- **Live demo:** [hr-emora.vercel.app](https://hr-emora.vercel.app)
- **Source:** [github.com/mohamedemam-creator/hr-emora](https://github.com/mohamedemam-creator/hr-emora)

## Maintainer

**Mohamed Ahmed Emam** — Full-stack web development, Next.js, Supabase, and PostgreSQL.
