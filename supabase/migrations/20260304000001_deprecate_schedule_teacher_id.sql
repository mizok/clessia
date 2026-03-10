ALTER TABLE IF EXISTS public.schedules
  ALTER COLUMN teacher_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.schedules
  DROP CONSTRAINT IF EXISTS schedules_teacher_id_fkey;

DO $$
BEGIN
  IF to_regclass('public.schedules') IS NOT NULL
    AND to_regclass('public.staff') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'schedules'
        AND column_name = 'teacher_id'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.schedules')
        AND c.conname = 'schedules_teacher_id_fkey'
    ) THEN
    ALTER TABLE public.schedules
      ADD CONSTRAINT schedules_teacher_id_fkey
      FOREIGN KEY (teacher_id)
      REFERENCES public.staff(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedules'
      AND column_name = 'teacher_id'
  ) THEN
    COMMENT ON COLUMN public.schedules.teacher_id
      IS 'DEPRECATED: 老師指派改由 batch-assign 處理';
  END IF;
END;
$$;
