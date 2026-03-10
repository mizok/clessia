DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'session_assignment_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.session_assignment_status AS ENUM ('assigned', 'unassigned');
  END IF;
END $$;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS assignment_status public.session_assignment_status;

UPDATE public.sessions
SET assignment_status = CASE
  WHEN teacher_id IS NULL THEN 'unassigned'::public.session_assignment_status
  ELSE 'assigned'::public.session_assignment_status
END
WHERE assignment_status IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN assignment_status SET DEFAULT 'assigned',
  ALTER COLUMN assignment_status SET NOT NULL,
  ALTER COLUMN teacher_id DROP NOT NULL;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_assignment_consistent_chk;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_assignment_consistent_chk CHECK (
    (assignment_status = 'assigned' AND teacher_id IS NOT NULL)
    OR
    (assignment_status = 'unassigned' AND teacher_id IS NULL)
  );
