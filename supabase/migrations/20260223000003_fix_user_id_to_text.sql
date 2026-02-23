-- Migration: Fix user_id columns to TEXT to match Better Auth's nano ID format
-- Better Auth uses TEXT IDs (nano IDs), not UUIDs.
-- staff.user_id and user_roles.user_id were pointing to profiles(id) uuid — wrong.
-- Auth is handled at Hono middleware layer, so RLS policies on business tables
-- are dropped here (per CLAUDE.md: 業務表不使用 RLS).

-- ── Drop RLS policies that reference user_roles.user_id ───────
-- (These policies join user_roles, blocking the column type change)
DROP POLICY IF EXISTS "Admins can manage staff" ON public.staff;
DROP POLICY IF EXISTS "Admins can view staff" ON public.staff;
DROP POLICY IF EXISTS "Admins can manage staff_campuses" ON public.staff_campuses;
DROP POLICY IF EXISTS "Admins can view staff_campuses" ON public.staff_campuses;
DROP POLICY IF EXISTS "Admins can manage courses" ON public.courses;
DROP POLICY IF EXISTS "Admins can view courses" ON public.courses;
DROP POLICY IF EXISTS "Admins can manage campuses" ON public.campuses;
DROP POLICY IF EXISTS "Admins can view campuses" ON public.campuses;
DROP POLICY IF EXISTS "Admins can manage classes" ON public.classes;
DROP POLICY IF EXISTS "Admins can view classes" ON public.classes;
DROP POLICY IF EXISTS "Admins can manage schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins can view schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins can manage sessions" ON public.sessions;
DROP POLICY IF EXISTS "Admins can view sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;

-- ── user_roles ────────────────────────────────────────────────
-- Drop primary key (includes user_id)
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_pkey;

-- Drop old FK to profiles
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;

-- Change user_id from uuid to text
ALTER TABLE public.user_roles ALTER COLUMN user_id TYPE text USING user_id::text;

-- Recreate primary key
ALTER TABLE public.user_roles ADD PRIMARY KEY (user_id, role);

-- Add new FK to ba_user
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.ba_user(id) ON DELETE CASCADE;

-- ── staff ─────────────────────────────────────────────────────
-- Drop unique constraint (includes user_id)
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_user_id_org_id_key;

-- Drop old FK to profiles
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_user_id_fkey;

-- Change user_id from uuid to text
ALTER TABLE public.staff ALTER COLUMN user_id TYPE text USING user_id::text;

-- Recreate unique constraint
ALTER TABLE public.staff ADD CONSTRAINT staff_user_id_org_id_key UNIQUE (user_id, org_id);

-- Add new FK to ba_user
ALTER TABLE public.staff
  ADD CONSTRAINT staff_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.ba_user(id) ON DELETE CASCADE;
