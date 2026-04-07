ALTER TABLE public.audit_logs
  DROP CONSTRAINT audit_logs_resource_type_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class',
      'course',
      'campus',
      'staff',
      'session',
      'student',
      'parent',
      'enrollment',
      'attendance',
      'leave'
    )
  );
