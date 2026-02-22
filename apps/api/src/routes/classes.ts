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

    dbQuery = dbQuery
      .range(offset, offset + pageSize - 1)
      .order('created_at', { ascending: false });

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
        data: mapClass(classResult.data as Record<string, unknown>, schedulesResult.data || []),
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
      return c.json({ data: [] }, 200);
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

    return c.json({ data: previews }, 200);
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

    const { data: schedules } = await supabase.from('schedules').select('*').eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json({ created: 0, skipped: 0 }, 200);
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
      return c.json({ created: 0, skipped: 0 }, 200);
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

    return c.json({ created, skipped }, 200);
  }
);

export default app;
