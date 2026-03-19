-- Add email column to students table for future student account support
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS email text;
