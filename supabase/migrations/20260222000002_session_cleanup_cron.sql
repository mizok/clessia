-- Migration: Scheduled cleanup of expired Better Auth sessions
-- Why: Better Auth stores sessions in ba_session table but does not automatically
-- delete expired records. Without cleanup, the table grows indefinitely.
-- This job runs weekly to remove sessions past their expiresAt timestamp.
--
-- Note: pg_cron must be enabled in the Supabase Dashboard (Extensions page)
-- before this migration takes effect in production.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Grant necessary privileges for cron jobs to run
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule weekly cleanup every Sunday at 03:00 AM
-- Removes all sessions that have already expired
SELECT cron.schedule(
  'cleanup-expired-ba-sessions',    -- job name (unique)
  '0 3 * * 0',                      -- cron expression: Sunday 03:00
  $$
    DELETE FROM public.ba_session
    WHERE "expiresAt" < NOW();
  $$
);
