create type public.grade_level as enum (
  'K',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'J1', 'J2', 'J3',
  'S1', 'S2', 'S3'
);

create type public.student_gender as enum (
  'male', 'female', 'prefer_not_to_say'
);

create table public.students (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete restrict,
  name                    text not null,
  grade                   public.grade_level not null,
  school                  text not null,
  birthday                date,
  gender                  public.student_gender,
  phone                   text,
  address                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  notes                   text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index students_org_id_idx on public.students (org_id);
create index students_name_idx on public.students (name);
create index students_grade_idx on public.students (grade);
create index students_active_idx on public.students (is_active);

create trigger students_updated_at
  before update on public.students
  for each row execute function public.update_updated_at();

create table public.parents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete restrict,
  name       text not null,
  phone      text,
  email      text,
  notes      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index parents_org_id_idx on public.parents (org_id);
create index parents_name_idx on public.parents (name);

create trigger parents_updated_at
  before update on public.parents
  for each row execute function public.update_updated_at();

create table public.parent_student_relations (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references public.parents(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relation   text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique(parent_id, student_id)
);

create index psr_student_id_idx on public.parent_student_relations (student_id);

alter table public.audit_logs
  drop constraint audit_logs_resource_type_check;

alter table public.audit_logs
  add constraint audit_logs_resource_type_check
  check (resource_type in ('class', 'course', 'campus', 'staff', 'session', 'student'));
