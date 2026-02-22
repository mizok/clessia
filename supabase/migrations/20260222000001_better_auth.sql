-- Migration: Better Auth schema transition
-- Why this exists:
-- 1) Introduce Better Auth core tables with `ba_` prefix to avoid name conflicts
--    with Supabase/Auth default tables and existing domain tables.
-- 2) Decouple application identity from `auth.users` by removing `profiles.id -> auth.users.id` FK
--    and removing legacy auto-profile trigger/function.
-- 3) Remove existing RLS policies because authorization now moves to Hono middleware,
--    which performs role/organization checks at the API layer during this transition phase.

-- Better Auth tables (ba_ prefix to avoid conflicts)
CREATE TABLE IF NOT EXISTS public.ba_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  username TEXT UNIQUE,
  phone TEXT,
  "orgId" UUID REFERENCES public.organizations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.ba_session (
  id TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.ba_account (
  id TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ba_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now()
);

-- Better Auth indexes
CREATE INDEX IF NOT EXISTS ba_session_user_id_idx ON public.ba_session("userId");
CREATE INDEX IF NOT EXISTS ba_account_user_id_idx ON public.ba_account("userId");
CREATE INDEX IF NOT EXISTS ba_session_token_idx ON public.ba_session(token);

-- Remove legacy FK from profiles to auth.users
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Remove legacy auth trigger/function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Remove known RLS policies
-- profiles
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- user_roles
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;

-- organizations
DROP POLICY IF EXISTS "Users can read own organization" ON public.organizations;
DROP POLICY IF EXISTS "Admins can manage organizations" ON public.organizations;

-- campuses
DROP POLICY IF EXISTS "Users can read campuses in own organization" ON public.campuses;
DROP POLICY IF EXISTS "Admins can manage campuses" ON public.campuses;

-- courses
DROP POLICY IF EXISTS "Users can read courses in own organization" ON public.courses;
DROP POLICY IF EXISTS "Admins can manage courses" ON public.courses;

-- staff
DROP POLICY IF EXISTS "Users can read staff in own organization" ON public.staff;
DROP POLICY IF EXISTS "Admins can manage staff" ON public.staff;
DROP POLICY IF EXISTS "Users can read staff campuses in own organization" ON public.staff_campuses;
DROP POLICY IF EXISTS "Admins can manage staff campuses" ON public.staff_campuses;

-- subjects
DROP POLICY IF EXISTS "Users can read subjects in own organization" ON public.subjects;
DROP POLICY IF EXISTS "Admins can manage subjects" ON public.subjects;
DROP POLICY IF EXISTS "Users can read staff subjects in own organization" ON public.staff_subjects;
DROP POLICY IF EXISTS "Admins can manage staff subjects" ON public.staff_subjects;
