# 開課班管理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 實作 `/admin/classes` 頁面，將課程（Course）與班級（Class）合併為層級式管理頁面，含上課時間（schedules）與課堂批次產生（sessions）功能。

**Architecture:** 三層實作：DB migration（classes/schedules/sessions 三表）→ Hono API（/api/classes）→ Angular UI（classes.page 重寫）。課程為群組標題，班級為可展開行，4 個 PrimeNG Dialog。

**Tech Stack:** Hono 4.11.9 + @hono/zod-openapi, Zod 4.3.6（`z.uuid()` 語法，非 `z.string().uuid()`）, Angular 21.1.0, PrimeNG 21.1.1, Vitest 4.0.8, Supabase PostgreSQL

---

## Task 1: DB Migration（Phase 2）
**執行者：Codex**

**Files:**
- Create: `supabase/migrations/20260223000001_create_classes.sql`

### Step 1: 建立 migration 檔

```sql
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
  is_recommended boolean NOT NULL DEFAULT false,
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
  -- classroom_id 跳過（MVP）
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
```

### Step 2: Reset DB

Run: `supabase db reset`
Expected: 無錯誤，三張表成功建立。

### Step 3: 確認 tables 存在

Run: `supabase db execute --local "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('classes','schedules','sessions') ORDER BY table_name;"`
Expected: 3 rows（classes, schedules, sessions）。

### Step 4: Commit

```bash
git add supabase/migrations/20260223000001_create_classes.sql
git commit -m "feat(db): add classes, schedules, sessions tables with RLS"
```

---

## Task 2: API Route — /api/classes（Phase 3）
**執行者：Codex**

**Files:**
- Create: `apps/api/src/routes/classes.ts`
- Modify: `apps/api/src/index.ts`（新增 import + route mount）

### Step 1: 建立 apps/api/src/routes/classes.ts

完整內容如下（模式參照 `apps/api/src/routes/courses.ts`）：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const ScheduleSchema = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    weekday: z.number().int().min(1).max(7),
    startTime: z.string(),
    endTime: z.string(),
    teacherId: z.uuid(),
    teacherName: z.string().optional(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .openapi('Schedule');

const ClassSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    campusId: z.uuid(),
    courseId: z.uuid(),
    courseName: z.string().optional(),
    name: z.string(),
    maxStudents: z.number(),
    gradeLevels: z.array(z.string()),
    isRecommended: z.boolean(),
    nextClassId: z.uuid().nullable(),
    isActive: z.boolean(),
    schedules: z.array(ScheduleSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Class');

const ClassListResponseSchema = z
  .object({
    data: z.array(ClassSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('ClassListResponse');

const CreateClassSchema = z
  .object({
    courseId: z.uuid(),
    name: z.string().min(1).max(50),
    maxStudents: z.number().int().min(1).max(200).optional(),
    gradeLevels: z.array(z.string()).optional(),
    isRecommended: z.boolean().optional(),
    nextClassId: z.uuid().nullable().optional(),
  })
  .openapi('CreateClass');

const UpdateClassSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    maxStudents: z.number().int().min(1).max(200).optional(),
    gradeLevels: z.array(z.string()).optional(),
    isRecommended: z.boolean().optional(),
    nextClassId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateClass');

const CreateScheduleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    teacherId: z.uuid(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable().optional(),
  })
  .openapi('CreateSchedule');

const SessionPreviewSchema = z
  .object({
    sessionDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    teacherId: z.uuid(),
    teacherName: z.string().optional(),
    weekday: z.number(),
    exists: z.boolean(),
  })
  .openapi('SessionPreview');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('Error');

const QueryParamsSchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  campusId: z.uuid().optional(),
  courseId: z.uuid().optional(),
  isActive: z.string().optional(),
});

// ============================================================
// Helpers
// ============================================================

function mapSchedule(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    classId: row['class_id'] as string,
    weekday: row['weekday'] as number,
    startTime: row['start_time'] as string,
    endTime: row['end_time'] as string,
    teacherId: row['teacher_id'] as string,
    teacherName: (row['staff'] as { display_name: string } | null)?.display_name,
    effectiveFrom: row['effective_from'] as string,
    effectiveTo: (row['effective_to'] as string | null) ?? null,
  };
}

function mapClass(row: Record<string, unknown>, schedules?: unknown[]) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    campusId: row['campus_id'] as string,
    courseId: row['course_id'] as string,
    courseName: (row['courses'] as { name: string } | null)?.name,
    name: row['name'] as string,
    maxStudents: row['max_students'] as number,
    gradeLevels: (row['grade_levels'] as string[]) ?? [],
    isRecommended: row['is_recommended'] as boolean,
    nextClassId: (row['next_class_id'] as string | null) ?? null,
    isActive: row['is_active'] as boolean,
    schedules: schedules?.map((s) => mapSchedule(s as Record<string, unknown>)),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/classes
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Classes'],
    summary: '取得班級列表',
    request: { query: QueryParamsSchema },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: ClassListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const query = c.req.valid('query');
    const page = parseInt(query.page || '1');
    const pageSize = parseInt(query.pageSize || '50');
    const offset = (page - 1) * pageSize;

    let dbQuery = supabase.from('classes').select('*, courses(name)', { count: 'exact' });

    if (query.search) dbQuery = dbQuery.ilike('name', `%${query.search}%`);
    if (query.campusId) dbQuery = dbQuery.eq('campus_id', query.campusId);
    if (query.courseId) dbQuery = dbQuery.eq('course_id', query.courseId);
    if (query.isActive !== undefined) dbQuery = dbQuery.eq('is_active', query.isActive === 'true');

    dbQuery = dbQuery.range(offset, offset + pageSize - 1).order('created_at', { ascending: false });

    const { data, count, error } = await dbQuery;
    if (error) console.error('DB Error:', error);

    return c.json({
      data: (data || []).map((r) => mapClass(r as Record<string, unknown>)),
      meta: {
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  }
);

// GET /api/classes/:id（含 schedules）
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Classes'],
    summary: '取得單一班級（含上課時間）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    const [classResult, schedulesResult] = await Promise.all([
      supabase.from('classes').select('*, courses(name)').eq('id', id).single(),
      supabase.from('schedules').select('*, staff(display_name)').eq('class_id', id),
    ]);

    if (classResult.error || !classResult.data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json(
      {
        data: mapClass(
          classResult.data as Record<string, unknown>,
          schedulesResult.data || []
        ),
      },
      200
    );
  }
);

// POST /api/classes
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Classes'],
    summary: '新增班級',
    request: {
      body: { content: { 'application/json': { schema: CreateClassSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      400: {
        description: '驗證錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班名重複',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    // 從 course 取得 campus_id
    const { data: course } = await supabase
      .from('courses')
      .select('campus_id')
      .eq('id', body.courseId)
      .single();

    if (!course) {
      return c.json({ error: '課程不存在', code: 'COURSE_NOT_FOUND' }, 400);
    }

    const { data, error } = await supabase
      .from('classes')
      .insert({
        org_id: orgId,
        campus_id: course.campus_id,
        course_id: body.courseId,
        name: body.name,
        max_students: body.maxStudents ?? 20,
        grade_levels: body.gradeLevels ?? [],
        is_recommended: body.isRecommended ?? false,
        next_class_id: body.nextClassId ?? null,
      })
      .select('*, courses(name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '此分校已有同名班級', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    return c.json({ data: mapClass(data as Record<string, unknown>) }, 201);
  }
);

// PUT /api/classes/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Classes'],
    summary: '更新班級',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateClassSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData['name'] = body.name;
    if (body.maxStudents !== undefined) updateData['max_students'] = body.maxStudents;
    if (body.gradeLevels !== undefined) updateData['grade_levels'] = body.gradeLevels;
    if (body.isRecommended !== undefined) updateData['is_recommended'] = body.isRecommended;
    if (body.nextClassId !== undefined) updateData['next_class_id'] = body.nextClassId;
    if (body.isActive !== undefined) updateData['is_active'] = body.isActive;

    const { data, error } = await supabase
      .from('classes')
      .update(updateData)
      .eq('id', id)
      .select('*, courses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data: mapClass(data as Record<string, unknown>) }, 200);
  }
);

// PATCH /api/classes/:id/toggle-active
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/toggle-active',
    tags: ['Classes'],
    summary: '切換班級啟用/停用',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    const { data: current } = await supabase
      .from('classes')
      .select('is_active')
      .eq('id', id)
      .single();

    if (!current) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data, error } = await supabase
      .from('classes')
      .update({ is_active: !current.is_active })
      .eq('id', id)
      .select('*, courses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 404);
    }

    return c.json({ data: mapClass(data as Record<string, unknown>) }, 200);
  }
);

// DELETE /api/classes/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Classes'],
    summary: '刪除班級（無 sessions 才可刪）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '已有課堂記錄，無法刪除',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', id);

    if (count && count > 0) {
      return c.json(
        { error: `此班級已有 ${count} 筆課堂記錄，無法刪除`, code: 'HAS_SESSIONS' },
        409
      );
    }

    const { error } = await supabase.from('classes').delete().eq('id', id);
    if (error) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ success: true }, 200);
  }
);

// POST /api/classes/:id/schedules
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/schedules',
    tags: ['Classes'],
    summary: '新增上課時間',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: CreateScheduleSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ScheduleSchema }) } },
      },
      400: {
        description: '驗證錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '時段重複',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('schedules')
      .insert({
        class_id: id,
        weekday: body.weekday,
        start_time: body.startTime,
        end_time: body.endTime,
        teacher_id: body.teacherId,
        effective_from: body.effectiveFrom,
        effective_to: body.effectiveTo ?? null,
      })
      .select('*, staff(display_name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '此時段已存在', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 201);
  }
);

// PUT /api/classes/:id/schedules/:sid
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/schedules/{sid}',
    tags: ['Classes'],
    summary: '更新上課時間',
    request: {
      params: z.object({ id: z.uuid(), sid: z.uuid() }),
      body: { content: { 'application/json': { schema: CreateScheduleSchema.partial() } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ScheduleSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id, sid } = c.req.valid('param');
    const body = c.req.valid('json');

    const updateData: Record<string, unknown> = {};
    if (body.weekday !== undefined) updateData['weekday'] = body.weekday;
    if (body.startTime !== undefined) updateData['start_time'] = body.startTime;
    if (body.endTime !== undefined) updateData['end_time'] = body.endTime;
    if (body.teacherId !== undefined) updateData['teacher_id'] = body.teacherId;
    if (body.effectiveFrom !== undefined) updateData['effective_from'] = body.effectiveFrom;
    if (body.effectiveTo !== undefined) updateData['effective_to'] = body.effectiveTo;

    const { data, error } = await supabase
      .from('schedules')
      .update(updateData)
      .eq('id', sid)
      .eq('class_id', id)
      .select('*, staff(display_name)')
      .single();

    if (error || !data) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 200);
  }
);

// DELETE /api/classes/:id/schedules/:sid
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/schedules/{sid}',
    tags: ['Classes'],
    summary: '刪除上課時間',
    request: { params: z.object({ id: z.uuid(), sid: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id, sid } = c.req.valid('param');

    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', sid)
      .eq('class_id', id);

    if (error) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ success: true }, 200);
  }
);

// GET /api/classes/:id/sessions/preview
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/sessions/preview',
    tags: ['Classes'],
    summary: '預覽將產生的課堂',
    request: {
      params: z.object({ id: z.uuid() }),
      query: z.object({ from: z.string(), to: z.string() }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(SessionPreviewSchema) }) },
        },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const { data: schedules } = await supabase
      .from('schedules')
      .select('*, staff(display_name)')
      .eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json({ data: [] });
    }

    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('session_date, start_time')
      .eq('class_id', id)
      .gte('session_date', from)
      .lte('session_date', to);

    const existingSet = new Set(
      (existingSessions || []).map(
        (s: { session_date: string; start_time: string }) => `${s.session_date}|${s.start_time}`
      )
    );

    const previews: Array<{
      sessionDate: string;
      startTime: string;
      endTime: string;
      teacherId: string;
      teacherName?: string;
      weekday: number;
      exists: boolean;
    }> = [];

    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const isoDate = cursor.toISOString().split('T')[0];
      // JS getDay(): 0=Sun, 1=Mon...6=Sat → 我們: 1=Mon...7=Sun
      const jsDay = cursor.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;

      for (const schedule of schedules) {
        if (schedule.weekday !== weekday) continue;

        const effFrom = new Date(schedule.effective_from);
        const effTo = schedule.effective_to ? new Date(schedule.effective_to) : null;

        if (cursor < effFrom) continue;
        if (effTo && cursor > effTo) continue;

        previews.push({
          sessionDate: isoDate,
          startTime: schedule.start_time,
          endTime: schedule.end_time,
          teacherId: schedule.teacher_id,
          teacherName: (schedule.staff as { display_name: string } | null)?.display_name,
          weekday,
          exists: existingSet.has(`${isoDate}|${schedule.start_time}`),
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    previews.sort(
      (a, b) =>
        a.sessionDate.localeCompare(b.sessionDate) || a.startTime.localeCompare(b.startTime)
    );

    return c.json({ data: previews });
  }
);

// POST /api/classes/:id/sessions/generate
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/sessions/generate',
    tags: ['Classes'],
    summary: '批次建立課堂',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          'application/json': { schema: z.object({ from: z.string(), to: z.string() }) },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ created: z.number(), skipped: z.number() }),
          },
        },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('json');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const { data: schedules } = await supabase
      .from('schedules')
      .select('*')
      .eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json({ created: 0, skipped: 0 });
    }

    const toInsert: Array<{
      org_id: string;
      class_id: string;
      schedule_id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      teacher_id: string;
      status: string;
    }> = [];

    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const isoDate = cursor.toISOString().split('T')[0];
      const jsDay = cursor.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;

      for (const schedule of schedules) {
        if (schedule.weekday !== weekday) continue;

        const effFrom = new Date(schedule.effective_from);
        const effTo = schedule.effective_to ? new Date(schedule.effective_to) : null;

        if (cursor < effFrom) continue;
        if (effTo && cursor > effTo) continue;

        toInsert.push({
          org_id: orgId,
          class_id: id,
          schedule_id: schedule.id,
          session_date: isoDate,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          teacher_id: schedule.teacher_id,
          status: 'scheduled',
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    if (toInsert.length === 0) {
      return c.json({ created: 0, skipped: 0 });
    }

    // upsert with ignoreDuplicates to skip existing sessions
    const { data: inserted, error } = await supabase
      .from('sessions')
      .upsert(toInsert, { onConflict: 'class_id,session_date,start_time', ignoreDuplicates: true })
      .select('id');

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    const created = inserted?.length ?? 0;
    const skipped = toInsert.length - created;

    return c.json({ created, skipped });
  }
);

export default app;
```

### Step 2: 修改 apps/api/src/index.ts

在第 9 行後（現有 import 區塊末尾）新增：
```typescript
import classesRoute from './routes/classes';
```

在第 132 行後（`app.route('/api/subjects', subjectsRoute);` 之後）新增：
```typescript
app.route('/api/classes', classesRoute);
```

### Step 3: 確認 TypeScript 無錯誤

Run: `cd apps/api && npx tsc --noEmit 2>&1`
Expected: 無錯誤輸出。

### Step 4: Commit

```bash
git add apps/api/src/routes/classes.ts apps/api/src/index.ts
git commit -m "feat(api): add /api/classes endpoints with schedules and sessions generation"
```

---

## Task 3: Frontend Service — classes.service.ts（Phase 4）
**執行者：Codex**

**Files:**
- Create: `apps/web/src/app/core/classes.service.ts`

### Step 1: 建立 classes.service.ts

參照 `apps/web/src/app/core/courses.service.ts` 的模式：

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Schedule {
  id: string;
  classId: string;
  weekday: number; // 1=Monday, 7=Sunday
  startTime: string; // HH:mm:ss
  endTime: string;
  teacherId: string;
  teacherName?: string;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
}

export interface Class {
  id: string;
  orgId: string;
  campusId: string;
  courseId: string;
  courseName?: string;
  name: string;
  maxStudents: number;
  gradeLevels: string[];
  isRecommended: boolean;
  nextClassId: string | null;
  isActive: boolean;
  schedules?: Schedule[];
  createdAt: string;
  updatedAt: string;
}

export interface ClassListResponse {
  data: Class[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ClassQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  campusId?: string;
  courseId?: string;
  isActive?: boolean;
}

export interface CreateClassInput {
  courseId: string;
  name: string;
  maxStudents?: number;
  gradeLevels?: string[];
  isRecommended?: boolean;
  nextClassId?: string | null;
}

export interface UpdateClassInput {
  name?: string;
  maxStudents?: number;
  gradeLevels?: string[];
  isRecommended?: boolean;
  nextClassId?: string | null;
  isActive?: boolean;
}

export interface CreateScheduleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  teacherId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface SessionPreview {
  sessionDate: string;
  startTime: string;
  endTime: string;
  teacherId: string;
  teacherName?: string;
  weekday: number;
  exists: boolean;
}

@Injectable({ providedIn: 'root' })
export class ClassesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/classes`;

  list(params?: ClassQueryParams): Observable<ClassListResponse> {
    return this.http.get<ClassListResponse>(this.endpoint, {
      params: this.toListParams(params),
    });
  }

  get(id: string): Observable<{ data: Class }> {
    return this.http.get<{ data: Class }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateClassInput): Observable<{ data: Class }> {
    return this.http.post<{ data: Class }>(this.endpoint, input);
  }

  update(id: string, input: UpdateClassInput): Observable<{ data: Class }> {
    return this.http.put<{ data: Class }>(`${this.endpoint}/${id}`, input);
  }

  toggleActive(id: string): Observable<{ data: Class }> {
    return this.http.patch<{ data: Class }>(`${this.endpoint}/${id}/toggle-active`, {});
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  addSchedule(classId: string, input: CreateScheduleInput): Observable<{ data: Schedule }> {
    return this.http.post<{ data: Schedule }>(`${this.endpoint}/${classId}/schedules`, input);
  }

  updateSchedule(
    classId: string,
    scheduleId: string,
    input: Partial<CreateScheduleInput>
  ): Observable<{ data: Schedule }> {
    return this.http.put<{ data: Schedule }>(
      `${this.endpoint}/${classId}/schedules/${scheduleId}`,
      input
    );
  }

  deleteSchedule(classId: string, scheduleId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.endpoint}/${classId}/schedules/${scheduleId}`
    );
  }

  previewSessions(
    classId: string,
    from: string,
    to: string
  ): Observable<{ data: SessionPreview[] }> {
    return this.http.get<{ data: SessionPreview[] }>(
      `${this.endpoint}/${classId}/sessions/preview`,
      { params: { from, to } }
    );
  }

  generateSessions(
    classId: string,
    from: string,
    to: string
  ): Observable<{ created: number; skipped: number }> {
    return this.http.post<{ created: number; skipped: number }>(
      `${this.endpoint}/${classId}/sessions/generate`,
      { from, to }
    );
  }

  private toListParams(params?: ClassQueryParams): Record<string, string | number | boolean> {
    if (!params) return {};

    const query: Record<string, string | number | boolean> = {};
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;
    if (params.search !== undefined) query['search'] = params.search;
    if (params.campusId !== undefined) query['campusId'] = params.campusId;
    if (params.courseId !== undefined) query['courseId'] = params.courseId;
    if (params.isActive !== undefined) query['isActive'] = params.isActive;

    return query;
  }
}
```

### Step 2: Commit

```bash
git add apps/web/src/app/core/classes.service.ts
git commit -m "feat(service): add ClassesService with full CRUD, schedule, and session methods"
```

---

## Task 4: Frontend Page — classes.page.ts（Phase 5）
**執行者：Claude**

> ⚠️ **UI 開發前必須 invoke `ui-ux-pro-max` skill**

**Files:**
- Create: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`
- Create: `apps/web/src/app/features/admin/pages/classes/classes.page.html`
- Create: `apps/web/src/app/features/admin/pages/classes/classes.page.scss`
- Modify: `apps/web/src/app/app.routes.ts`（更新 import 路徑與 component 名稱）
- Delete: `apps/web/src/app/features/admin/pages/classes/classes.component.ts`

### Step 1: 建立 classes.page.ts

Component class 名稱：`ClassesPage`（非 ClassesComponent）

**關鍵 Imports：**
- Services: `ClassesService`（from `@core/classes.service`）、`CoursesService`、`CampusesService`、`SubjectsService`、`StaffService`
- Interface: `Staff`（from `@core/staff.service`，非 StaffMember）
- PrimeNG: `TableModule`、`ButtonModule`、`InputTextModule`、`SelectModule`、`DialogModule`、`TagModule`、`ToastModule`、`ConfirmDialogModule`、`DatePickerModule`、`MultiSelectModule`、`ToggleSwitchModule`、`TooltipModule`

**Signals 狀態（完整清單）：**

```typescript
// 資料
protected readonly courses = signal<Course[]>([]);
protected readonly classes = signal<Class[]>([]);
protected readonly campuses = signal<Campus[]>([]);
protected readonly subjects = signal<Subject[]>([]);
protected readonly staff = signal<Staff[]>([]);
protected readonly loading = signal(false);
protected readonly expandedClassId = signal<string | null>(null);

// 篩選
protected readonly searchQuery = signal('');
protected readonly selectedCampusId = signal<string | null>(null);
protected readonly selectedSubjectId = signal<string | null>(null);
protected readonly statusFilter = signal<boolean | null>(null);

// Computed: 課程群組（含篩選邏輯）
protected readonly courseGroups = computed(() => {
  const allCourses = this.courses();
  const allClasses = this.classes();
  const search = this.searchQuery().toLowerCase();
  const campusId = this.selectedCampusId();
  const subjectId = this.selectedSubjectId();
  const isActive = this.statusFilter();

  return allCourses
    .filter((c) => {
      if (campusId && c.campusId !== campusId) return false;
      if (subjectId && c.subjectId !== subjectId) return false;
      return true;
    })
    .map((course) => ({
      course,
      classes: allClasses.filter((cl) => {
        if (cl.courseId !== course.id) return false;
        if (search && !cl.name.toLowerCase().includes(search)) return false;
        if (isActive !== null && cl.isActive !== isActive) return false;
        return true;
      }),
    }))
    .filter((g) => g.classes.length > 0 || (!search && isActive === null));
});

// Course Dialog
protected readonly courseDialogVisible = signal(false);
protected readonly courseDialogMode = signal<'create' | 'edit'>('create');
protected readonly editingCourseId = signal<string | null>(null);
protected readonly courseForm = signal({
  campusId: '', name: '', subjectId: '', description: null as string | null, isActive: true,
});

// Class Dialog
protected readonly classDialogVisible = signal(false);
protected readonly classDialogMode = signal<'create' | 'edit'>('create');
protected readonly editingClassId = signal<string | null>(null);
protected readonly classDialogCourseId = signal<string | null>(null);
protected readonly classForm = signal({
  name: '', maxStudents: 20, gradeLevels: [] as string[],
  isRecommended: false, nextClassId: null as string | null, isActive: true,
});
protected readonly scheduleEntries = signal<ScheduleFormEntry[]>([]);

// Generate Sessions Dialog
protected readonly generateDialogVisible = signal(false);
protected readonly generateTargetClassId = signal<string | null>(null);
protected readonly generateFrom = signal<Date | null>(null);
protected readonly generateTo = signal<Date | null>(null);
protected readonly previewSessions = signal<SessionPreview[]>([]);
protected readonly generateLoading = signal(false);
protected readonly generateStep = signal<'input' | 'preview'>('input');
```

**ScheduleFormEntry interface（在 component 外定義）：**
```typescript
export interface ScheduleFormEntry {
  id?: string;        // 現有 schedule id（editing 時）
  weekday: number | null;
  startTime: string;  // HH:mm
  endTime: string;
  teacherId: string;
  effectiveFrom: string;  // YYYY-MM-DD
  effectiveTo: string | null;
}
```

**靜態選項清單：**
```typescript
protected readonly gradeOptions = [
  { label: '國小一', value: '國小一' }, { label: '國小二', value: '國小二' },
  { label: '國小三', value: '國小三' }, { label: '國小四', value: '國小四' },
  { label: '國小五', value: '國小五' }, { label: '國小六', value: '國小六' },
  { label: '國中一', value: '國中一' }, { label: '國中二', value: '國中二' },
  { label: '國中三', value: '國中三' },
  { label: '高中一', value: '高中一' }, { label: '高中二', value: '高中二' },
  { label: '高中三', value: '高中三' },
];

protected readonly weekdayOptions = [
  { label: '週一', value: 1 }, { label: '週二', value: 2 }, { label: '週三', value: 3 },
  { label: '週四', value: 4 }, { label: '週五', value: 5 }, { label: '週六', value: 6 },
  { label: '週日', value: 7 },
];

protected readonly statusOptions = [
  { label: '全部', value: null }, { label: '啟用', value: true }, { label: '停用', value: false },
];
```

**loadAll() 方法（ngOnInit 中呼叫）：**
```typescript
protected loadAll(): void {
  this.loading.set(true);
  Promise.all([
    this.coursesService.list({ pageSize: 200 }).toPromise(),
    this.classesService.list({ pageSize: 500 }).toPromise(),
    this.campusesService.list().toPromise(),
    this.subjectsService.list().toPromise(),
    this.staffService.list({ pageSize: 200 }).toPromise(),
  ]).then(([coursesRes, classesRes, campusesRes, subjectsRes, staffRes]) => {
    this.courses.set(coursesRes?.data ?? []);
    this.classes.set(classesRes?.data ?? []);
    this.campuses.set((campusesRes as any)?.data ?? []);
    this.subjects.set(subjectsRes?.data ?? []);
    this.staff.set(staffRes?.data ?? []);
    this.loading.set(false);
  });
}
```

> **注意：** `CampusesService.list()` 和 `SubjectsService.list()` 可能沒有 meta wrapper，需確認其回傳型別後調整。

**展開/收合班級 detail：**
```typescript
protected toggleExpand(classId: string): void {
  if (this.expandedClassId() === classId) {
    this.expandedClassId.set(null);
    return;
  }
  // 載入完整資料（含 schedules）
  this.classesService.get(classId).subscribe((res) => {
    this.classes.update((list) => list.map((cl) => cl.id === classId ? res.data : cl));
    this.expandedClassId.set(classId);
  });
}
```

**saveCourse()：** 依 courseDialogMode 呼叫 create 或 update，成功後更新 courses signal，關閉 dialog，顯示 toast。

**saveClass()：** 依 classDialogMode：
- create：先 create class，再依序 addSchedule（for each scheduleEntries）
- edit：先 update class，再 diff schedules（刪除移除的、新增新的）
- 操作完成後 get(classId) 重新載入完整資料，更新 classes signal

**confirmDeleteCourse / confirmDeleteClass：** 使用 `ConfirmationService.confirm()`。

**confirmToggleActive：** 呼叫 `classesService.toggleActive()`，更新 classes signal 中對應班級。

**previewSessionsAction() 和 confirmGenerateSessions()：** 分別呼叫 previewSessions 和 generateSessions，更新 dialog step。

**輔助方法：**
```typescript
protected getWeekdayLabel(weekday: number): string {
  return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
}

protected getScheduleSummary(schedules: Schedule[]): string {
  return schedules
    .map((s) => `${this.getWeekdayLabel(s.weekday)} ${s.startTime.substring(0, 5)}-${s.endTime.substring(0, 5)}`)
    .join('、');
}
```

### Step 2: 建立 classes.page.html

HTML 主要結構：

```html
<p-toast />
<p-confirmDialog />

<div class="classes-page">
  <!-- Header -->
  <div class="page-header">
    <h1>{{ page().label }}</h1>
    <p-button label="+ 新增課程" (onClick)="openCreateCourseDialog()" />
  </div>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <input pInputText [(ngModel)]="searchQuery()" ... />
    <p-select [options]="campuses()" ... [(ngModel)]="selectedCampusId()" ... />
    <p-select [options]="subjects()" ... [(ngModel)]="selectedSubjectId()" ... />
    <p-select [options]="statusOptions" ... [(ngModel)]="statusFilter()" ... />
    <p-button label="清除篩選" (onClick)="clearFilters()" ... />
  </div>

  <!-- Course Groups -->
  @if (loading()) {
    <p-progressBar mode="indeterminate" />
  } @else {
    @for (group of courseGroups(); track group.course.id) {
      <!-- Course Group Header -->
      <div class="course-group">
        <div class="course-header">
          <span class="course-title">
            {{ group.course.campusName }} › {{ group.course.name }}
          </span>
          <span class="course-subject">{{ group.course.subjectName }}</span>
          <div class="course-actions">
            <p-button label="編輯課程" (onClick)="openEditCourseDialog(group.course)" ... />
            <p-button label="+ 新增班" (onClick)="openCreateClassDialog(group.course.id)" ... />
          </div>
        </div>

        <!-- Class Rows -->
        @for (cls of group.classes; track cls.id) {
          <div class="class-row" [class.expanded]="isExpanded(cls.id)">
            <div class="class-summary" (click)="toggleExpand(cls.id)">
              <i class="pi" [class.pi-chevron-right]="!isExpanded(cls.id)"
                           [class.pi-chevron-down]="isExpanded(cls.id)"></i>
              <span class="class-name">{{ cls.name }}</span>
              <span class="class-schedule">{{ getScheduleSummary(cls.schedules ?? []) }}</span>
              <p-tag [value]="cls.isActive ? '啟用' : '停用'"
                     [severity]="cls.isActive ? 'success' : 'secondary'" />
            </div>

            @if (isExpanded(cls.id)) {
              <div class="class-detail">
                <div class="schedules-list">
                  @for (s of cls.schedules; track s.id) {
                    <div class="schedule-item">
                      {{ getWeekdayLabel(s.weekday) }}
                      {{ s.startTime.substring(0,5) }}-{{ s.endTime.substring(0,5) }}
                      · {{ s.teacherName }}
                      · 起: {{ s.effectiveFrom }}
                    </div>
                  }
                </div>
                <div class="class-actions">
                  <p-button label="編輯班級" (onClick)="openEditClassDialog(cls)" ... />
                  <p-button label="產生課堂" (onClick)="openGenerateDialog(cls)" ... />
                  <p-button [label]="cls.isActive ? '停用' : '啟用'"
                            (onClick)="confirmToggleActive(cls)" ... />
                  <p-button label="刪除" (onClick)="confirmDeleteClass(cls)" severity="danger" ... />
                </div>
              </div>
            }
          </div>
        } @empty {
          <div class="no-classes">此課程尚無班級</div>
        }
      </div>
    } @empty {
      <div class="empty-state">
        <i class="pi pi-inbox"></i>
        <p>尚未建立任何課程</p>
      </div>
    }
  }
</div>

<!-- Course Dialog -->
<p-dialog [(visible)]="courseDialogVisible()" ... header="...">
  <!-- campusId select（新增時顯示）、name、subjectId select、description textarea、isActive toggle -->
</p-dialog>

<!-- Class Dialog -->
<p-dialog [(visible)]="classDialogVisible()" ... header="...">
  <!-- name、maxStudents、gradeLevels multi-select、isRecommended toggle、nextClassId select -->
  <!-- 上課時間清單 + 新增/刪除按鈕 -->
  <!-- 每筆 ScheduleFormEntry: weekday select、startTime/endTime input、teacherId select、effectiveFrom -->
</p-dialog>

<!-- Generate Sessions Dialog -->
<p-dialog [(visible)]="generateDialogVisible()" ... header="產生課堂">
  @if (generateStep() === 'input') {
    <p-datepicker [(ngModel)]="generateFrom()" ... />
    <p-datepicker [(ngModel)]="generateTo()" ... />
    <p-button label="預覽" (onClick)="previewSessionsAction()" [loading]="generateLoading()" />
  } @else {
    <!-- Preview list table -->
    @for (s of previewSessions(); track s.sessionDate + s.startTime) {
      <tr [class.exists]="s.exists">
        <td>{{ s.sessionDate }}</td>
        <td>{{ getWeekdayLabel(s.weekday) }}</td>
        <td>{{ s.startTime.substring(0,5) }}-{{ s.endTime.substring(0,5) }}</td>
        <td>{{ s.teacherName }}</td>
        <td>{{ s.exists ? '已存在（略過）' : '將新增' }}</td>
      </tr>
    }
    <p-button label="確認建立" (onClick)="confirmGenerateSessions()" [loading]="generateLoading()" />
    <p-button label="返回" (onClick)="generateStep.set('input')" ... />
  }
</p-dialog>
```

> **⚠️ 重要：** ngModel 與 signal 的綁定需使用 `[(ngModel)]` + getter/setter 或使用 `(ngModelChange)="signal.set($event)"` 形式，不能直接 `[(ngModel)]="signal()"` 因為 signal 不是 writable ref。建議：表單欄位使用物件形式 signal，binding 方式：`[ngModel]="courseForm().name" (ngModelChange)="updateCourseForm('name', $event)"`。

### Step 3: 修改 app.routes.ts

找到以下行：
```typescript
loadComponent: () => import('@features/admin/pages/classes/classes.component').then((m) => m.ClassesComponent),
```
改為：
```typescript
loadComponent: () => import('@features/admin/pages/classes/classes.page').then((m) => m.ClassesPage),
```

### Step 4: 刪除舊 placeholder

```bash
rm apps/web/src/app/features/admin/pages/classes/classes.component.ts
```

### Step 5: Build check

Run: `cd apps/web && npx ng build --no-progress 2>&1 | tail -20`
Expected: `Build at: ... – Time: ...ms` 無錯誤。

### Step 6: Commit

```bash
git add apps/web/src/app/features/admin/pages/classes/
git add apps/web/src/app/app.routes.ts
git commit -m "feat(ui): implement classes page with merged courses+classes hierarchical view"
```

---

## Task 5: 側邊欄更新（Phase 5b）
**執行者：Claude**

**Files:**
- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.ts`（第 37 行）

### Step 1: 隱藏 ADMIN_COURSES

在 `routes-catalog.ts` 第 37 行，找到：
```typescript
public static readonly ADMIN_COURSES = this.register('courses', '/admin/courses', '課程列表', UserType.ADMIN, 'pi-book', true, '教務管理');
```
將 `true`（showInMenu）改為 `false`：
```typescript
public static readonly ADMIN_COURSES = this.register('courses', '/admin/courses', '課程列表', UserType.ADMIN, 'pi-book', false, '教務管理');
```

### Step 2: Build check

Run: `cd apps/web && npx ng build --no-progress 2>&1 | tail -5`
Expected: 無錯誤。

### Step 3: Commit

```bash
git add apps/web/src/app/core/smart-enums/routes-catalog.ts
git commit -m "feat(nav): hide ADMIN_COURSES from sidebar (merged into /admin/classes)"
```

---

## Task 6: E2E 驗證（Phase 6）
**執行者：Codex**

### Step 1: 啟動開發環境

```bash
supabase start
cd apps/api && npx wrangler dev --local &
cd apps/web && npx ng serve &
```

### Step 2: Happy Path 驗證清單

1. 進入 `/admin/classes` → 確認頁面載入，無 JS 錯誤
2. 點「+ 新增課程」→ 填入分校/名稱/科目 → 儲存 → 確認課程出現在群組列表
3. 點課程群組「+ 新增班」→ 填班名 + 新增 2 個時段 → 儲存 → 確認班級出現
4. 點班級行展開 → 確認上課時間正確顯示
5. 點「產生課堂」→ 選日期範圍（2 週）→ 點預覽 → 確認列出課堂 → 點確認
6. Toast 顯示「已建立 N 筆課堂」
7. 再次產生相同日期範圍 → 預覽顯示「已存在（略過）」
8. 點「停用」→ 確認班級顯示停用 Tag
9. 用分校下拉篩選 → 確認只顯示該分校課程
10. 確認側邊欄「課程列表」項目已消失，只有「開課班管理」

### Step 3: 確認無 console errors

瀏覽器 F12 → Console → 確認無紅色錯誤。

---

## 注意事項

| 項目 | 說明 |
|------|------|
| Zod v4 語法 | `z.uuid()` 而非 `z.string().uuid()` |
| campus_id 推導 | 新增班級時，campus_id 從 course 取得，frontend 不傳 |
| Weekday 轉換 | JS `getDay()`: 0=Sun → 我們: 1=Mon, 7=Sun |
| Session upsert | `ignoreDuplicates: true` 跳過重複而非拋錯 |
| ngModel + Signal | 表單欄位用 `(ngModelChange)` 手動更新 signal，不可直接 `[(ngModel)]="signal()"` |
| Staff interface | 使用 `Staff`（來自 `@core/staff.service`），屬性為 `displayName` |
| SubjectsService.list() | 回傳 `{ data: Subject[] }`（無 meta），注意 CampusesService 確認同樣結構 |
| schedules 展開載入 | 班級 detail 展開時才觸發 `classesService.get(classId)` 取得完整 schedules |

---

*計畫由 Claude Code 於 2026-02-23 生成*
