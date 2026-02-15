create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campuses_org_id_name_key unique (org_id, name)
);

create index campuses_org_id_idx on public.campuses (org_id);

alter table public.campuses enable row level security;

create policy "Users can read campuses in own organization"
  on public.campuses for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.org_id = campuses.org_id
    )
  );

create policy "Admins can manage campuses"
  on public.campuses for all
  using (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = campuses.org_id
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = campuses.org_id
        and ur.role = 'admin'::public.user_role
    )
  );

create trigger campuses_updated_at
  before update on public.campuses
  for each row execute function public.update_updated_at();
