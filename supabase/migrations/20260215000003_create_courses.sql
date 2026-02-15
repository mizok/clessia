create table public.courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  name text not null,
  subject text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_campus_id_name_key unique (campus_id, name)
);

create index courses_org_id_idx on public.courses (org_id);
create index courses_campus_id_idx on public.courses (campus_id);

alter table public.courses enable row level security;

create policy "Users can read courses in own organization"
  on public.courses for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.org_id = courses.org_id
    )
  );

create policy "Admins can manage courses"
  on public.courses for all
  using (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = courses.org_id
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = courses.org_id
        and ur.role = 'admin'::public.user_role
    )
  );

create trigger courses_updated_at
  before update on public.courses
  for each row execute function public.update_updated_at();
