-- Allow NULL teacher_id in schedules
-- A schedule without a teacher can exist; sessions cannot be generated until a teacher is assigned.
ALTER TABLE public.schedules ALTER COLUMN teacher_id DROP NOT NULL;
