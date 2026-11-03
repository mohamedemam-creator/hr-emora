-- Clean-foundation schema. Review-only rebuild chain; not the active Supabase CLI chain.
-- Intended for an empty database after an explicitly approved reset/new project.
create schema if not exists app_private;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platform authority is an independent server-provisioned identity. Never seed from a company role.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  grant_reason text not null
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid,
  status text not null default 'active' check (status in ('invited','active','suspended','ended')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id,user_id),
  unique (id,company_id,user_id)
);
create index if not exists company_memberships_user_status_idx on public.company_memberships(user_id,status,company_id);

-- Selected tenant context is persisted server-side; app_select_company validates membership.
create table if not exists public.user_company_context (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null,
  foreign key(company_id,user_id) references public.company_memberships(company_id,user_id) on delete cascade,
  updated_at timestamptz not null default now()
);

-- Separate platform context permits audited cross-company work without membership impersonation.
create table if not exists public.platform_admin_context (
  user_id uuid primary key references public.platform_admins(user_id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null,
  manager_employee_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code), unique(id,company_id)
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  region_id uuid,
  name text not null,
  code text not null,
  address text,
  location extensions.geography(Point,4326),
  attendance_radius_m integer not null default 100 check(attendance_radius_m between 25 and 1000),
  minimum_gps_accuracy_m integer not null default 100 check(minimum_gps_accuracy_m between 1 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code), unique(id,company_id),
  foreign key(region_id,company_id) references public.regions(id,company_id) on delete restrict
);
create index if not exists branches_region_idx on public.branches(company_id,region_id);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code), unique(id,company_id)
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code), unique(id,company_id)
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  scope_level text not null default 'company'
    check(scope_level in ('company','region','branch','department','own')),
  primary key(role_id,permission_id,scope_level)
);

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid,
  name text not null,
  code text not null,
  default_role_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code), unique(id,company_id),
  foreign key(department_id,company_id) references public.departments(id,company_id) on delete set null (department_id),
  foreign key(default_role_id,company_id) references public.roles(id,company_id) on delete set null (default_role_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_code text not null,
  full_name text not null,
  phone text,
  email text,
  address text,
  branch_id uuid,
  department_id uuid,
  job_title_id uuid,
  direct_manager_id uuid,
  hire_date date,
  employment_status text not null default 'active' check(employment_status in ('active','inactive','suspended','terminated','on_leave')),
  salary_type text check(salary_type is null or salary_type in ('monthly','daily','hourly')),
  base_salary numeric(14,2) not null default 0 check(base_salary >= 0),
  overtime_hour_rate numeric(14,2) not null default 0 check(overtime_hour_rate >= 0),
  default_daily_hours numeric(4,2) not null default 9 check(default_daily_hours between 1 and 24),
  must_change_password boolean not null default false,
  login_enabled boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,employee_code), unique(id,company_id),
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete set null (branch_id),
  foreign key(department_id,company_id) references public.departments(id,company_id) on delete set null (department_id),
  foreign key(job_title_id,company_id) references public.job_titles(id,company_id) on delete set null (job_title_id),
  foreign key(direct_manager_id,company_id) references public.employees(id,company_id) on delete set null (direct_manager_id)
);
create unique index if not exists employees_company_user_idx on public.employees(company_id,user_id) where user_id is not null;
create index if not exists employees_company_branch_idx on public.employees(company_id,branch_id,employment_status);
create index if not exists employees_company_manager_idx on public.employees(company_id,direct_manager_id);
alter table public.company_memberships add constraint company_memberships_employee_company_fk
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete set null (employee_id);
alter table public.regions add constraint regions_manager_company_fk
  foreign key(manager_employee_id,company_id) references public.employees(id,company_id) on delete set null (manager_employee_id);

create table if not exists public.employee_roles (
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references public.employees(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key(employee_id,role_id)
);

create table if not exists public.employee_branch_assignments (
  employee_id uuid not null,
  branch_id uuid not null,
  company_id uuid not null,
  starts_on date not null default current_date,
  ends_on date,
  assigned_at timestamptz not null default now(),
  check(ends_on is null or ends_on>=starts_on),
  primary key(employee_id,branch_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete cascade
);
create table if not exists public.employee_region_assignments (
  employee_id uuid not null,
  region_id uuid not null,
  company_id uuid not null,
  starts_on date not null default current_date,
  ends_on date,
  assigned_at timestamptz not null default now(),
  check(ends_on is null or ends_on>=starts_on),
  primary key(employee_id,region_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(region_id,company_id) references public.regions(id,company_id) on delete cascade
);
create table if not exists public.employee_scope_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  role_id uuid not null,
  company_id uuid not null,
  scope_level text not null check(scope_level in ('company','region','branch','department','own')),
  scope_id uuid,
  created_at timestamptz not null default now(),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(employee_id,role_id) references public.employee_roles(employee_id,role_id) on delete cascade,
  check((scope_level='company' and scope_id is null) or (scope_level<>'company' and scope_id is not null))
);
create index if not exists employee_scope_lookup_idx on public.employee_scope_assignments(employee_id,role_id,scope_level,scope_id);
