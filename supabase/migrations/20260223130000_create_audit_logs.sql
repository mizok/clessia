CREATE TABLE public.audit_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        text NOT NULL,
  user_id       text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  user_name     text,
  resource_type text NOT NULL CHECK (resource_type IN ('class', 'course', 'campus', 'staff')),
  resource_id   text,
  resource_name text,
  action        text NOT NULL,
  details       jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX audit_logs_org_created_idx ON public.audit_logs(org_id, created_at DESC);
CREATE INDEX audit_logs_resource_type_idx ON public.audit_logs(resource_type);

COMMENT ON TABLE public.audit_logs IS '記錄所有管理操作的稽核日誌';
