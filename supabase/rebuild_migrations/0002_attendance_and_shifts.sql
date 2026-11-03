-- Operational attendance and scheduling tables; tenant keys are carried through composite FKs.
create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid, name text not null, code text not null, start_time time not null, end_time time not null,
  grace_minutes integer not null default 0 check(grace_minutes between 0 and 480),
  break_minutes integer not null default 0 check(break_minutes between 0 and 720),
  is_break_paid boolean not null default true, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,code), unique(id,company_id),
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete restrict
);
create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null, branch_id uuid not null, shift_template_id uuid,
  shift_date date not null, day_type text not null default 'work' check(day_type in ('work','off','leave','mission')),
  planned_start time, planned_end time, status text not null default 'draft' check(status in ('draft','published','cancelled','completed')),
  notes text, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(employee_id,shift_date), unique(id,company_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete restrict,
  foreign key(shift_template_id,company_id) references public.shift_templates(id,company_id) on delete set null (shift_template_id)
);
create index if not exists shift_assignments_company_date_idx on public.shift_assignments(company_id,shift_date,branch_id);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null, branch_id uuid not null, shift_assignment_id uuid,
  work_date date not null, check_in_at timestamptz, check_out_at timestamptz,
  check_in_location extensions.geography(Point,4326), check_out_location extensions.geography(Point,4326),
  check_in_accuracy_m numeric(8,2), check_out_accuracy_m numeric(8,2),
  check_in_distance_m numeric(10,2), check_out_distance_m numeric(10,2),
  check_in_device_id text, check_out_device_id text,
  source text not null default 'web' check(source in ('web','ios','admin','import','system')),
  attendance_status text not null default 'present' check(attendance_status in ('present','late','absent','leave','off','corrected','open','early_leave','missing_checkout','under_review')),
  late_minutes integer not null default 0 check(late_minutes>=0), early_leave_minutes integer not null default 0 check(early_leave_minutes>=0),
  worked_minutes integer check(worked_minutes is null or worked_minutes>=0),
  original_late_minutes integer, adjusted_by uuid references public.employees(id) on delete set null,
  adjusted_at timestamptz, adjustment_reason text, manual_adjustment_reason text, manager_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,company_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete restrict,
  foreign key(shift_assignment_id,company_id) references public.shift_assignments(id,company_id) on delete set null (shift_assignment_id)
);
create index if not exists attendance_company_date_idx on public.attendance_sessions(company_id,work_date,branch_id);
create index if not exists attendance_employee_date_idx on public.attendance_sessions(employee_id,work_date desc);
create index if not exists attendance_open_employee_idx on public.attendance_sessions(employee_id,check_in_at desc) where check_out_at is null;

create table if not exists public.geofence_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null, branch_id uuid not null,
  attendance_session_id uuid,
  event_type text not null, detected_at timestamptz not null default now(),
  action text check(action is null or action in ('check_in','check_out','position')),
  location extensions.geography(Point,4326), accuracy_m numeric(8,2), device_id text,
  accepted boolean not null default false, rejection_reason text, created_at timestamptz not null default now(),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete restrict,
  foreign key(attendance_session_id,company_id) references public.attendance_sessions(id,company_id) on delete set null (attendance_session_id)
);
create index if not exists geofence_events_employee_time_idx on public.geofence_events(employee_id,created_at desc);

create table if not exists public.web_attendance_exceptions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  enabled boolean not null default false, reason text, set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(employee_id),
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade
);

create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, assignment_id uuid,
  employee_id uuid not null, branch_id uuid not null, shift_template_id uuid, shift_date date not null,
  request_type text not null check(request_type in ('upsert','delete')),
  requested_day_type text, requested_start time, requested_end time, requested_status text,
  leave_type_id uuid, notes text, old_data jsonb, new_data jsonb,
  requested_by uuid references public.employees(id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz, reviewer_notes text,
  foreign key(employee_id,company_id) references public.employees(id,company_id) on delete cascade,
  foreign key(branch_id,company_id) references public.branches(id,company_id) on delete restrict,
  foreign key(assignment_id,company_id) references public.shift_assignments(id,company_id) on delete set null (assignment_id),
  foreign key(shift_template_id,company_id) references public.shift_templates(id,company_id) on delete set null (shift_template_id)
);
create index if not exists shift_change_company_status_idx on public.shift_change_requests(company_id,status,requested_at desc);
