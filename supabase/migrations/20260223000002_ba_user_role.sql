-- Better Auth admin plugin requires extra columns on ba_user.
-- These are separate from our app-level `user_roles` table.
-- Required by adminPlugin(): role, banned, banReason, banExpires

ALTER TABLE public.ba_user
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "banReason" TEXT,
  ADD COLUMN IF NOT EXISTS "banExpires" TIMESTAMPTZ;
