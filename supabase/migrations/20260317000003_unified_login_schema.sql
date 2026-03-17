-- supabase/migrations/20260317000003_unified_login_schema.sql
-- Unified login schema changes:
-- 1. Add UNIQUE constraint to ba_user.phone (nullable; PostgreSQL allows multiple NULLs)
-- 2. Remove email/phone from staff (single source of truth: ba_user)
-- 3. Remove email/phone from parents (single source of truth: ba_user)

ALTER TABLE public.ba_user
  ADD CONSTRAINT ba_user_phone_key UNIQUE (phone);

ALTER TABLE public.staff
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;

ALTER TABLE public.parents
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;
