-- Remove 'K' (幼稚園) from grade_level enum
-- This cram school system does not serve kindergarten students.

-- Step 1: Create new enum without 'K'
CREATE TYPE public.grade_level_new AS ENUM (
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'J1', 'J2', 'J3',
  'S1', 'S2', 'S3'
);

-- Step 2: Migrate existing column data (any accidental 'K' rows would fail here intentionally)
ALTER TABLE public.students
  ALTER COLUMN grade TYPE public.grade_level_new
  USING grade::text::public.grade_level_new;

-- Step 3: Replace old type
DROP TYPE public.grade_level;
ALTER TYPE public.grade_level_new RENAME TO grade_level;
