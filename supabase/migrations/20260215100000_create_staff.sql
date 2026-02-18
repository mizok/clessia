create table public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  phone text,
  email text not null,
  birthday date,
  notes text,
  subjects text[] default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_user_id_org_id_key unique (user_id, org_id)
);

create table public.staff_campuses (
  staff_id uuid not null references public.staff(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  primary key (staff_id, campus_id)
);

create index staff_org_id_idx on public.staff (org_id);
create index staff_user_id_idx on public.staff (user_id);

create index staff_campuses_staff_id_idx on public.staff_campuses (staff_id);
create index staff_campuses_campus_id_idx on public.staff_campuses (campus_id);

alter table public.staff enable row level security;
alter table public.staff_campuses enable row level security;

create policy "Users can read staff in own organization"
  on public.staff for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.org_id = staff.org_id
    )
  );

create policy "Admins can manage staff"
  on public.staff for all
  using (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = staff.org_id
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = staff.org_id
        and ur.role = 'admin'::public.user_role
    )
  );

create policy "Users can read staff campuses in own organization"
  on public.staff_campuses for select
  using (
    exists (
      select 1
      from public.staff s
      join public.campuses c on c.id = staff_campuses.campus_id
      join public.profiles p on p.id = (select auth.uid())
      where s.id = staff_campuses.staff_id
        and c.org_id = s.org_id
        and p.org_id = s.org_id
    )
  );

create policy "Admins can manage staff campuses"
  on public.staff_campuses for all
  using (
    exists (
      select 1
      from public.staff s
      join public.campuses c on c.id = staff_campuses.campus_id
      join public.profiles p on p.id = (select auth.uid())
      join public.user_roles ur on ur.user_id = p.id
      where s.id = staff_campuses.staff_id
        and c.org_id = s.org_id
        and p.org_id = s.org_id
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.staff s
      join public.campuses c on c.id = staff_campuses.campus_id
      join public.profiles p on p.id = (select auth.uid())
      join public.user_roles ur on ur.user_id = p.id
      where s.id = staff_campuses.staff_id
        and c.org_id = s.org_id
        and p.org_id = s.org_id
        and ur.role = 'admin'::public.user_role
    )
  );

create trigger staff_updated_at
  before update on public.staff
  for each row execute function public.update_updated_at();
