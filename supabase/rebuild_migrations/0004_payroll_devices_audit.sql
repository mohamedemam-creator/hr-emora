-- Financial, account-device, and append-oriented audit records.
create table if not exists public.payroll_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  overtime_enabled boolean not null default true,
  monthly_divisor numeric(8,2) not null default 30 check(monthly_divisor>0),
  deduct_absence boolean not null default true,
  deduct_late_minutes boolean not null default false,
  deduct_early_leave_minutes boolean not null default false,
  deduct_unpaid_leave boolean not null default true,
  overtime_multiplier numeric(6,3) not null default 1.5 check(overtime_multiplier>=0),
  currency_code text not null default 'EGP', updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.payroll_cycles (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null, period_end date not null,
  month_start date generated always as (date_trunc('month',period_start::timestamp without time zone)::date) stored,
  label text not null,
  status text not null default 'draft' check(status in ('draft','reviewed','closed')),
  calculated_at timestamptz, calculated_by uuid, reviewed_at timestamptz, reviewed_by uuid,
  closed_at timestamptz, closed_by uuid, reopened_at timestamptz, reopened_by uuid,
  notes text, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,period_start,period_end), unique(id,company_id), check(period_end>=period_start),
  foreign key(created_by,company_id) references public.employees(id,company_id) on delete set null (created_by),
  foreign key(calculated_by,company_id) references public.employees(id,company_id) on delete set null (calculated_by),
  foreign key(reviewed_by,company_id) references public.employees(id,company_id) on delete set null (reviewed_by),
  foreign key(closed_by,company_id) references public.employees(id,company_id) on delete set null (closed_by),
  foreign key(reopened_by,company_id) references public.employees(id,company_id) on delete set null (reopened_by)
);
create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, cycle_id uuid not null,
  employee_id uuid not null, branch_id uuid,
  employee_code_snapshot text, employee_name_snapshot text, salary_type_snapshot text,
  overtime_hour_rate_snapshot numeric(14,2) not null default 0, default_daily_hours_snapshot numeric(4,2) not null default 9,
  base_salary_snapshot numeric(14,2) not null default 0, day_rate_snapshot numeric(14,2) not null default 0,
  present_days numeric(8,2) not null default 0, absent_days numeric(8,2) not null default 0,
  paid_leave_days numeric(8,2) not null default 0, unpaid_leave_days numeric(8,2) not null default 0,
  scheduled_work_days numeric(8,2) not null default 0, worked_minutes integer not null default 0,
  late_minutes integer not null default 0, early_leave_minutes integer not null default 0,
  gross_base numeric(14,2) not null default 0, gross_earnings numeric(14,2) not null default 0,
  overtime_minutes integer not null default 0, overtime_amount numeric(14,2) not null default 0,
  absence_deduction numeric(14,2) not null default 0, late_deduction numeric(14,2) not null default 0,
  early_leave_deduction numeric(14,2) not null default 0, unpaid_leave_deduction numeric(14,2) not null default 0,
  penalty_deduction numeric(14,2) not null default 0, manual_earnings numeric(14,2) not null default 0,
  manual_deductions numeric(14,2) not null default 0, total_deductions numeric(14,2) not null default 0,
  net_salary numeric(14,2) not null default 0, adjustment_notes text, updated_at timestamptz not null default now(),
  unique(cycle_id,employee_id),
  foreign key(cycle_id,company_id) references public.payroll_cycles(id,company_id) on delete cascade,
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete restrict,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete set null (branch_id)
);

create table if not exists public.ios_web_devices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  browser_id text not null, device_id text, public_key_spki text,
  status text not null default 'active' check(status in ('pending','active','released','revoked')),
  approved_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade
);
create table if not exists public.ios_web_device_requests (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  browser_id text, device_id text, public_key_spki text,
  request_code text not null unique,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(), created_at timestamptz not null default now(), reviewed_at timestamptz,
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade
);
create table if not exists public.mobile_devices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  device_id text not null, status text not null default 'active' check(status in ('active','released','revoked')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade
);
create unique index if not exists ios_web_devices_active_browser_uidx on public.ios_web_devices(company_id,browser_id) where status='active';
create unique index if not exists ios_web_devices_active_device_uidx on public.ios_web_devices(company_id,device_id) where status='active' and device_id is not null;
create unique index if not exists mobile_devices_active_device_uidx on public.mobile_devices(company_id,device_id) where status='active';
create unique index if not exists ios_web_requests_pending_browser_uidx on public.ios_web_device_requests(company_id,employee_id,browser_id) where status='pending';

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_platform_admin_id uuid references auth.users(id) on delete set null,
  actor_membership_id uuid references public.company_memberships(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  actor_company_role text,
  actor_platform_role text check(actor_platform_role is null or actor_platform_role='PLATFORM_SUPER_ADMIN'),
  actor_platform_admin boolean not null default false,
  company_id uuid references public.companies(id) on delete set null,
  action text not null, category text not null, entity_type text, entity_id uuid,
  status text not null check(status in ('success','failure','denied')),
  old_data jsonb, new_data jsonb, context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  request_id text
);
create index if not exists audit_logs_company_time_idx on public.audit_logs(company_id,occurred_at desc);
create index if not exists audit_logs_actor_time_idx on public.audit_logs(actor_user_id,occurred_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type,entity_id,occurred_at desc);
create index if not exists audit_logs_action_time_idx on public.audit_logs(action,occurred_at desc);

-- New tables must remain unavailable to browser roles while this chain is
-- applied one migration at a time. The later RPC migration grants only the
-- server-side service_role access it needs.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'payroll_settings', 'payroll_cycles', 'payroll_items',
    'ios_web_devices', 'ios_web_device_requests', 'mobile_devices', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
  end loop;
end;
$$;
