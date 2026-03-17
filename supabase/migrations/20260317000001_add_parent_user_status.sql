-- 1. 新增 status enum
create type public.parent_status as enum ('active', 'inactive', 'archived');

-- 2. 為 parents 表新增欄位
alter table public.parents
  add column user_id text not null references ba_user(id),
  add column status public.parent_status not null default 'active';

-- 3. 移除舊欄位
alter table public.parents drop column is_active;

-- 4. Indexes & constraints
create unique index parents_user_id_org_id_udx on public.parents (user_id, org_id);
create index parents_status_idx on public.parents (status);

-- 注意：parents_updated_at trigger 已由 20260316110000 建立，無需重建

-- 5. Audit log 支援 parent resource type
alter table public.audit_logs
  drop constraint audit_logs_resource_type_check;
alter table public.audit_logs
  add constraint audit_logs_resource_type_check
  check (resource_type in ('class','course','campus','staff','session','student','parent'));
