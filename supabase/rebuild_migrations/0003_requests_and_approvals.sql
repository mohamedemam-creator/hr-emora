-- Configurable staged workflows. Organizational manager links are data, not implicit permissions.
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, code text not null, is_paid boolean not null default false,
  requires_attachment boolean not null default false, annual_entitlement numeric(8,2), is_active boolean not null default true,
  unique(company_id,code), unique(id,company_id)
);
alter table public.shift_change_requests add constraint shift_change_leave_type_company_fk
  foreign key(leave_type_id,company_id) references public.leave_types(id,company_id) on delete restrict;
create table if not exists public.approval_workflow_definitions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  request_type text not null, name text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,request_type), unique(id,company_id)
);
create table if not exists public.request_approval_stages (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  workflow_definition_id uuid not null, stage_order integer not null check(stage_order>0),
  approver_kind text not null check(approver_kind in ('role','manager','branch_manager','region_manager','company_owner','named_employee')),
  approver_role_id uuid, approver_employee_id uuid, scope_level text not null check(scope_level in ('company','region','branch','department','own')),
  required boolean not null default true,
  unique(workflow_definition_id,stage_order), unique(id,company_id),
  foreign key(workflow_definition_id,company_id) references public.approval_workflow_definitions(id,company_id) on delete cascade,
  foreign key(approver_role_id,company_id) references public.roles(id,company_id) on delete restrict,
  foreign key(approver_employee_id,company_id) references public.employees(id,company_id) on delete restrict
);
-- One approval instance per business request; stage routing is company-configurable.
create table if not exists public.request_approval_workflows (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  workflow_definition_id uuid, request_type text not null, request_id uuid not null,
  employee_id uuid not null, branch_id uuid, region_id uuid,
  current_stage text not null default 'branch', current_stage_order integer not null default 1 check(current_stage_order>0),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  branch_decision text, branch_reviewed_at timestamptz, branch_note text,
  branch_reviewed_by uuid references public.employees(id) on delete set null,
  region_decision text, region_reviewed_at timestamptz, region_note text,
  region_reviewed_by uuid references public.employees(id) on delete set null,
  final_status text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  unique(request_type,request_id),
  unique(id,company_id),
  foreign key(workflow_definition_id,company_id) references public.approval_workflow_definitions(id,company_id) on delete restrict,
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete restrict,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete set null (branch_id),
  foreign key(region_id,company_id) references public.regions(id,company_id) on delete set null (region_id),
  check(current_stage in ('branch','region','completed') or current_stage like 'stage:%')
);
create table if not exists public.request_approval_actions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  request_workflow_id uuid not null, stage_id uuid not null, actor_employee_id uuid not null,
  decision text not null check(decision in ('approved','rejected')), comments text,
  acted_at timestamptz not null default now(),
  foreign key(request_workflow_id,company_id) references public.request_approval_workflows(id,company_id) on delete cascade,
  foreign key(stage_id,company_id) references public.request_approval_stages(id,company_id) on delete restrict,
  foreign key(actor_employee_id,company_id) references public.employees(id,company_id) on delete restrict
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  leave_type_id uuid not null, starts_on date not null, ends_on date not null, requested_days numeric(8,2) not null check(requested_days>0),
  reason text, status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.employees(id) on delete set null, reviewer_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_on>=starts_on), unique(id,company_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(leave_type_id,company_id) references public.leave_types(id,company_id) on delete restrict
);
create table if not exists public.employee_hour_permissions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  permission_date date not null, permission_type text not null check(permission_type in ('late_arrival','early_leave')),
  requested_minutes integer not null check(requested_minutes between 1 and 1440), reason text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  review_note text, reviewed_by_employee_id uuid references public.employees(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,company_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade
);
create table if not exists public.employee_penalties (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  penalty_type text not null, title text not null, reason text, amount numeric(14,2) not null default 0 check(amount>=0),
  deduction_days numeric(8,2) not null default 0 check(deduction_days>=0), effective_date date not null,
  status text not null default 'approved' check(status in ('approved','cancelled')),
  created_by_employee_id uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), cancelled_by uuid,
  cancelled_at timestamptz,cancellation_reason text,
  unique(id,company_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete restrict,
  foreign key(created_by_employee_id,company_id) references public.employees(id,company_id) on delete set null (created_by_employee_id),
  foreign key(cancelled_by,company_id) references public.employees(id,company_id) on delete set null (cancelled_by)
);
create table if not exists public.penalty_approval_requests (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  employee_id uuid not null, branch_id uuid, region_id uuid,
  penalty_type text not null, title text not null, reason text, amount numeric(14,2) not null default 0 check(amount>=0),
  deduction_days numeric(8,2) not null default 0 check(deduction_days>=0), effective_date date not null,
  created_by_employee_id uuid,
  materialized_penalty_id uuid,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  review_note text, reviewed_by_employee_id uuid,
  reviewed_at timestamptz, updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete restrict,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete set null (branch_id),
  foreign key(region_id,company_id) references public.regions(id,company_id) on delete set null (region_id),
  foreign key(created_by_employee_id,company_id) references public.employees(id,company_id) on delete set null (created_by_employee_id),
  foreign key(reviewed_by_employee_id,company_id) references public.employees(id,company_id) on delete set null (reviewed_by_employee_id),
  foreign key(materialized_penalty_id,company_id) references public.employee_penalties(id,company_id) on delete set null (materialized_penalty_id)
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, recipient_employee_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  notification_type text not null, title text not null, body text not null,
  entity_type text, entity_id uuid, read_at timestamptz, created_at timestamptz not null default now(),
  foreign key(recipient_employee_id,company_id) references public.employees(id,company_id) on delete cascade
);
create index if not exists notifications_recipient_unread_idx on public.notifications(recipient_employee_id,created_at desc) where read_at is null;
