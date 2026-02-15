create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add org_id to profiles BEFORE creating policies that reference it
alter table public.profiles
  add column org_id uuid references public.organizations(id);

create index profiles_org_id_idx on public.profiles (org_id);

alter table public.organizations enable row level security;

create policy "Users can read own organization"
  on public.organizations for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.org_id = organizations.id
    )
  );

create policy "Admins can manage organizations"
  on public.organizations for all
  using (
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = (select auth.uid())
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.user_roles ur
      where ur.user_id = (select auth.uid())
        and ur.role = 'admin'::public.user_role
    )
  );

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.update_updated_at();
