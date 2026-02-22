-- ============================================================
-- subjects table（org 層級科目清單）
-- ============================================================
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint subjects_org_id_name_key unique (org_id, name)
);

create index subjects_org_id_idx on public.subjects (org_id);

alter table public.subjects enable row level security;

create policy "Users can read subjects in own organization"
  on public.subjects for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.org_id = subjects.org_id
    )
  );

create policy "Admins can manage subjects"
  on public.subjects for all
  using (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = subjects.org_id
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.user_roles ur on ur.user_id = p.id
      where p.id = (select auth.uid())
        and p.org_id = subjects.org_id
        and ur.role = 'admin'::public.user_role
    )
  );

-- ============================================================
-- 預設科目：為所有現有 org 插入預設清單
-- ============================================================
insert into public.subjects (org_id, name, sort_order)
select o.id, s.name, s.sort_order
from public.organizations o
cross join (
  values ('國文', 0), ('英文', 1), ('數學', 2), ('自然', 3), ('社會', 4), ('其他', 5)
) as s(name, sort_order);

-- 保留 courses 中已有但不在預設清單的科目
insert into public.subjects (org_id, name, sort_order)
select distinct c.org_id, c.subject, 99
from public.courses c
where not exists (
  select 1 from public.subjects s
  where s.org_id = c.org_id and s.name = c.subject
);

-- 保留 staff 中已有但不在預設清單的科目
insert into public.subjects (org_id, name, sort_order)
select distinct st.org_id, unnested, 99
from public.staff st, unnest(st.subjects) as unnested
where not exists (
  select 1 from public.subjects s
  where s.org_id = st.org_id and s.name = unnested
);

-- ============================================================
-- 遷移 courses.subject text → subject_id uuid FK
-- ============================================================
alter table public.courses add column subject_id uuid references public.subjects(id) on delete restrict;

update public.courses c
set subject_id = (
  select s.id from public.subjects s
  where s.org_id = c.org_id and s.name = c.subject
  limit 1
);

alter table public.courses alter column subject_id set not null;
alter table public.courses drop column subject;

create index courses_subject_id_idx on public.courses (subject_id);

-- ============================================================
-- staff_subjects junction table
-- ============================================================
create table public.staff_subjects (
  staff_id uuid not null references public.staff(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  primary key (staff_id, subject_id)
);

create index staff_subjects_staff_id_idx on public.staff_subjects (staff_id);
create index staff_subjects_subject_id_idx on public.staff_subjects (subject_id);

alter table public.staff_subjects enable row level security;

create policy "Users can read staff subjects in own organization"
  on public.staff_subjects for select
  using (
    exists (
      select 1
      from public.staff st
      join public.profiles p on p.id = (select auth.uid())
      where st.id = staff_subjects.staff_id
        and p.org_id = st.org_id
    )
  );

create policy "Admins can manage staff subjects"
  on public.staff_subjects for all
  using (
    exists (
      select 1
      from public.staff st
      join public.profiles p on p.id = (select auth.uid())
      join public.user_roles ur on ur.user_id = p.id
      where st.id = staff_subjects.staff_id
        and p.org_id = st.org_id
        and ur.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1
      from public.staff st
      join public.profiles p on p.id = (select auth.uid())
      join public.user_roles ur on ur.user_id = p.id
      where st.id = staff_subjects.staff_id
        and p.org_id = st.org_id
        and ur.role = 'admin'::public.user_role
    )
  );

-- 遷移 staff.subjects text[] → staff_subjects
insert into public.staff_subjects (staff_id, subject_id)
select st.id, sub.id
from public.staff st
join public.subjects sub on sub.org_id = st.org_id
where sub.name = any(st.subjects);

alter table public.staff drop column subjects;
