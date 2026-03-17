-- Allow ba_user.email to be NULL
-- Enables username-only accounts (e.g. root/system accounts without a real email)
ALTER TABLE public.ba_user
  ALTER COLUMN email DROP NOT NULL;
