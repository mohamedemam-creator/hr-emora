# Emora — HR Management & Time Attendance System

Emora is a web-based Human Resources Management System (HRMS) designed to help businesses manage employees, attendance, branches, shifts, leave requests, payroll-related operations, and workforce reporting through a centralized platform.

The system combines employee self-service workflows with administrative tools, location-aware attendance, and structured business data management.

The project is being developed with a focus on security, usability, scalability, and a modern Arabic-first experience with RTL support.

## Project Links

- **Live Demo:** https://hr-emora.vercel.app
- **GitHub Repository:** https://github.com/mohamedemam-creator/hr-emora

## Overview

Emora aims to centralize day-to-day HR operations in one application, reducing manual work and helping organizations manage their workforce more efficiently.

The platform is designed around company and branch management, role-based access, attendance workflows, employee records, and operational reporting.

Its architecture uses Next.js for the web application and Supabase for authentication, database services, and server-side operations through Edge Functions.

## Core Modules

### 1. Authentication & Access Control

- User authentication with Supabase Auth
- Company and administrator initialization
- Protected application workflows
- Role-based access and permissions

### 2. Employee Management

- Employee records and information management
- Employee and administrator workflows
- Employee access to relevant HR services
- Centralized workforce information

### 3. Branch & Location Management

- Company branch registration and management
- GPS-based location capture
- Browser geolocation integration
- Branch location configuration for attendance workflows

### 4. Time & Attendance

- Employee attendance workflows
- Location-aware attendance validation
- Attendance records and monitoring
- Attendance summaries and reporting

### 5. Shift Scheduling

- Work-shift organization
- Employee scheduling workflows
- Shift and attendance coordination

### 6. Leave Management

- Leave request submission
- Request review and approval workflows
- Leave records and tracking

### 7. Payroll Management

- Payroll-related administrative workflows
- Employee compensation records and operational tracking
- Integration with workforce and attendance information

### 8. Reports & Analytics

- Attendance summaries
- Workforce and operational reporting
- Attendance statistics and performance insights

## Technology Stack

| Category | Technologies |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Authentication | Supabase Auth |
| Database | PostgreSQL through Supabase |
| Backend Services | Supabase Edge Functions |
| Geolocation | Browser Geolocation API |
| Development | Node.js, npm |
| Version Control | Git, GitHub |
| Deployment Configuration | Cloudflare Workers |
| Live Demo Domain | Vercel |

## Architecture & Security

Emora uses Supabase as its backend platform, with PostgreSQL for structured application data and Supabase Auth for identity management.

Supabase Edge Functions handle selected server-side operations, including company initialization and branch creation.

Key engineering considerations include:

- Server-side validation for sensitive operations
- Secure handling of backend credentials
- Appropriate authentication and authorization checks
- PostgreSQL Row Level Security (RLS) policies for protected data
- Location permission handling through the browser
- Separation of frontend responsibilities from privileged backend operations

Security policies must be configured and verified against the actual application requirements before production use.

## Getting Started

### Prerequisites

- Node.js
- npm
- A Supabase project
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/mohamedemam-creator/hr-emora.git
cd hr-emora
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the project root, using `.env.example` as a reference.

Configure your Supabase project credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Obtain these values from your Supabase project settings.

Never commit `.env.local`, service-role keys, or other private credentials to GitHub.

### 4. Configure the Database

The project includes the following database migrations:

- `supabase/migrations/001_time_attendance_core.sql`
- `supabase/migrations/002_app_bootstrap_support.sql`

Apply the migrations in the correct order to the target Supabase database, following the project's existing database setup.

Do not apply a migration more than once if it has already been applied.

### 5. Deploy Supabase Edge Functions

Install the Supabase CLI and authenticate:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy the application functions:

```bash
supabase functions deploy bootstrap-company
supabase functions deploy create-branch
```

Configure any required server-side secrets using Supabase's supported secrets management.

The Supabase service-role key must never be exposed through client-side code or committed to the repository.

### 6. Run the Application Locally

```bash
npm run dev
```

Open:

http://localhost:3000

### 7. Preview and Deployment

The repository includes a Cloudflare deployment workflow.

For a local preview, run:

```bash
npm run preview
```

For deployment using the configured Cloudflare tooling:

```bash
npm run deploy
```

These commands depend on the deployment scripts and configuration included in the repository. Verify the configured build target and required environment variables before deploying.

The live demo URL listed above uses a Vercel domain. The production hosting configuration should be kept consistent with the actual deployment setup.

## Application Workflow

A typical company initialization workflow is:

1. Open the application.
2. Complete the initial company and administrator setup.
3. Access the administrative dashboard.
4. Navigate to branch management.
5. Register a branch and capture its location using browser geolocation.
6. Continue with employee, attendance, and other HR workflows.

Available workflows depend on the current application configuration and user permissions.

## Design Direction

Emora is intended to provide a modern, professional HR experience with an Arabic-first interface and right-to-left layout support.

The product's visual identity and interface are evolving alongside development. Branding references and early design concepts are part of the design process and should not be interpreted as the final approved visual identity.

## Project Status

**Status: Active Development**

Emora is being developed as an integrated HR management platform, with ongoing work across the application interface, authentication, database integration, location-aware workflows, and deployment configuration.

The GitHub repository and live demo provide access to the project for review. Implementation details and available functionality may evolve as development continues.

## Author

**Mohamed Ahmed Emam**

Computer Science graduate focused on full-stack web development, with practical project experience in Next.js, Supabase, PostgreSQL fundamentals, authentication, and business workflow management.

GitHub: https://github.com/mohamedemam-creator