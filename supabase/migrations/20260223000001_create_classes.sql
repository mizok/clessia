-- ============================================================
-- classes 表（開課班）
-- ============================================================
CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  max_students smallint NOT NULL DEFAULT 20,
  grade_levels text[] DEFAULT '{}',
  next_class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_campus_name_key UNIQUE (campus_id, name)
);

CREATE INDEX classes_org_id_idx ON public.classes (org_id);
CREATE INDEX classes_campus_id_idx ON public.classes (campus_id);
CREATE INDEX classes_course_id_idx ON public.classes (course_id);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read classes in own organization"
  ON public.classes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = classes.org_id
    )
  );

CREATE POLICY "Admins can manage classes"
  ON public.classes FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = classes.org_id
        AND ur.role = 'admin'::public.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = classes.org_id
        AND ur.role = 'admin'::public.user_role
    )
  );

CREATE TRIGGER classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- schedules 表（上課時間）
-- ============================================================
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- 1=週一, 7=週日
  start_time time NOT NULL,
  end_time time NOT NULL,
  teacher_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_to date, -- NULL = 持續有效
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_time_order CHECK (end_time > start_time),
  CONSTRAINT schedules_unique_slot UNIQUE (class_id, weekday, start_time, effective_from)
);

CREATE INDEX schedules_class_id_idx ON public.schedules (class_id);
CREATE INDEX schedules_teacher_id_idx ON public.schedules (teacher_id);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read schedules in own organization"
  ON public.schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.classes cl
      JOIN public.profiles p ON p.id = (SELECT auth.uid())
      WHERE cl.id = schedules.class_id
        AND p.org_id = cl.org_id
    )
  );

CREATE POLICY "Admins can manage schedules"
  ON public.schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.classes cl
      JOIN public.profiles p ON p.id = (SELECT auth.uid())
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE cl.id = schedules.class_id
        AND p.org_id = cl.org_id
        AND ur.role = 'admin'::public.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.classes cl
      JOIN public.profiles p ON p.id = (SELECT auth.uid())
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE cl.id = schedules.class_id
        AND p.org_id = cl.org_id
        AND ur.role = 'admin'::public.user_role
    )
  );

CREATE TRIGGER schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- sessions 表（課堂，由「產生課堂」批次建立）
-- ============================================================
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.schedules(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  teacher_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_class_date_time_key UNIQUE (class_id, session_date, start_time)
);

CREATE INDEX sessions_org_id_idx ON public.sessions (org_id);
CREATE INDEX sessions_class_id_idx ON public.sessions (class_id);
CREATE INDEX sessions_session_date_idx ON public.sessions (session_date);
CREATE INDEX sessions_teacher_id_idx ON public.sessions (teacher_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read sessions in own organization"
  ON public.sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = sessions.org_id
    )
  );

CREATE POLICY "Admins can manage sessions"
  ON public.sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = sessions.org_id
        AND ur.role = 'admin'::public.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = sessions.org_id
        AND ur.role = 'admin'::public.user_role
    )
  );

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
