import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';

// ============================================================
// Schemas (with OpenAPI metadata)
// ============================================================

const CourseSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    campusId: z.uuid(),
    campusName: z.string().optional(),
    name: z.string(),
    subjectId: z.uuid(),
    subjectName: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    gradeLevels: z.array(z.string()).default([]).openapi({ description: '適合年級' }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Course');

const CourseListResponseSchema = z
  .object({
    data: z.array(CourseSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('CourseListResponse');

const CreateCourseSchema = z
  .object({
    campusId: z.uuid().openapi({ description: '所屬分校 ID' }),
    name: z.string().min(1).max(50).openapi({ description: '課程名稱', example: '國一數學' }),
    subjectId: z.uuid().openapi({ description: '科目 ID' }),
    description: z.string().max(500).nullable().optional().openapi({ description: '課程說明' }),
    gradeLevels: z.array(z.string()).optional().openapi({ description: '適合年級' }),
  })
  .openapi('CreateCourse');

const UpdateCourseSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    subjectId: z.uuid().optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    gradeLevels: z.array(z.string()).optional(),
    deactivateMode: z.enum(['keep_sessions', 'cancel_future_sessions']).optional(),
  })
  .openapi('UpdateCourse');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('Error');

const QueryParamsSchema = z.object({
  page: z.string().optional().openapi({ description: '頁碼', example: '1' }),
  pageSize: z.string().optional().openapi({ description: '每頁筆數', example: '20' }),
  search: z.string().optional().openapi({ description: '搜尋課程名稱' }),
  campusId: z.uuid().optional().openapi({ description: '篩選分校' }),
  subjectId: z.uuid().optional().openapi({ description: '篩選科目 ID' }),
  isActive: z.string().optional().openapi({ description: '篩選狀態 (true/false)' }),
});

// ============================================================
// Helper function to map DB row to Course
// ============================================================

function mapCourse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    campusId: row['campus_id'] as string,
    campusName: (row['campuses'] as Record<string, unknown> | null)?.['name'] as string | undefined,
    name: row['name'] as string,
    subjectId: row['subject_id'] as string,
    subjectName: ((row['subjects'] as { name: string } | null)?.name ?? '') as string,
    description: row['description'] as string | null,
    isActive: row['is_active'] as boolean,
    gradeLevels: (row['grade_levels'] as string[]) ?? [],
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/courses - 取得課程列表
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Courses'],
  summary: '取得課程列表',
  description: '取得課程列表，支援分頁、搜尋、篩選',
  request: {
    query: QueryParamsSchema,
  },
  responses: {
    200: {
      description: '成功取得課程列表',
      content: {
        'application/json': {
          schema: CourseListResponseSchema,
        },
      },
    },
  },
});

app.openapi(listRoute, async (c) => {
  const supabase = c.get('supabase');
  const query = c.req.valid('query');

  const page = parseInt(query.page || '1');
  const pageSize = parseInt(query.pageSize || '20');
  const offset = (page - 1) * pageSize;

  // Build query
  let dbQuery = supabase
    .from('courses')
    .select('*, campuses(name), subjects(name)', { count: 'exact' });

  // Apply filters
  if (query.search) {
    dbQuery = dbQuery.ilike('name', `%${query.search}%`);
  }
  if (query.campusId) {
    dbQuery = dbQuery.eq('campus_id', query.campusId);
  }
  if (query.subjectId) {
    dbQuery = dbQuery.eq('subject_id', query.subjectId);
  }
  if (query.isActive !== undefined) {
    dbQuery = dbQuery.eq('is_active', query.isActive === 'true');
  }

  // Pagination
  dbQuery = dbQuery.range(offset, offset + pageSize - 1).order('created_at', { ascending: false });

  const { data, count, error } = await dbQuery;

  if (error) {
    console.error('DB Error:', error);
  }

  const courses = (data || []).map((row) => mapCourse(row as Record<string, unknown>));

  return c.json({
    data: courses,
    meta: {
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    },
  });
});

// GET /api/courses/:id - 取得單一課程
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Courses'],
  summary: '取得單一課程',
  request: {
    params: z.object({
      id: z.uuid().openapi({ description: '課程 ID' }),
    }),
  },
  responses: {
    200: {
      description: '成功取得課程',
      content: {
        'application/json': {
          schema: z.object({ data: CourseSchema }),
        },
      },
    },
    404: {
      description: '課程不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    400: {
      description: '操作失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(getRoute, async (c) => {
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');

  const { data, error } = await supabase
    .from('courses')
    .select('*, campuses(name), subjects(name)')
    .eq('id', id)
    .single();

  if (error || !data) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    data: mapCourse(data as Record<string, unknown>),
  }, 200);
});

// POST /api/courses - 新增課程
const createCourseRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Courses'],
  summary: '新增課程',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateCourseSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: '成功新增課程',
      content: {
        'application/json': {
          schema: z.object({ data: CourseSchema }),
        },
      },
    },
    400: {
      description: '驗證錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '課程名稱重複',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(createCourseRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('courses')
    .insert({
      org_id: orgId,
      campus_id: body.campusId,
      name: body.name,
      subject_id: body.subjectId,
      description: body.description || null,
      grade_levels: body.gradeLevels || [],
    })
    .select('*, campuses(name), subjects(name)')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '此分校已有同名課程', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(supabase, {
    orgId,
    userId,
    resourceType: 'course',
    resourceId: data.id as string,
    resourceName: data.name as string,
    action: 'create',
  }, c.executionCtx.waitUntil.bind(c.executionCtx));

  return c.json({ data: mapCourse(data as Record<string, unknown>) }, 201);
});

// PUT /api/courses/:id - 更新課程
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Courses'],
  summary: '更新課程',
  request: {
    params: z.object({
      id: z.uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateCourseSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功更新課程',
      content: {
        'application/json': {
          schema: z.object({
            data: CourseSchema,
            cancelledFutureSessions: z.number().optional(),
          }),
        },
      },
    },
    404: {
      description: '課程不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    400: {
      description: '操作失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(updateRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const { data: existingCourse, error: existingCourseError } = await supabase
    .from('courses')
    .select('id, is_active')
    .eq('id', id)
    .maybeSingle();

  if (existingCourseError || !existingCourse) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData['name'] = body.name;
  if (body.subjectId !== undefined) updateData['subject_id'] = body.subjectId;
  if (body.description !== undefined) updateData['description'] = body.description;
  if (body.isActive !== undefined) updateData['is_active'] = body.isActive;
  if (body.gradeLevels !== undefined) updateData['grade_levels'] = body.gradeLevels;
  const shouldCancelFutureSessions =
    body.isActive === false &&
    (existingCourse['is_active'] as boolean) &&
    body.deactivateMode === 'cancel_future_sessions';

  const { data, error } = await supabase
    .from('courses')
    .update(updateData)
    .eq('id', id)
    .select('*, campuses(name), subjects(name)')
    .single();

  if (error || !data) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  let cancelledFutureSessions = 0;
  if (shouldCancelFutureSessions) {
    const { data: classRows, error: classRowsError } = await supabase
      .from('classes')
      .select('id')
      .eq('org_id', orgId)
      .eq('course_id', id);

    if (classRowsError) {
      return c.json({ error: classRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const classIds = (classRows ?? [])
      .map((row) => row['id'] as string | undefined)
      .filter((classId): classId is string => !!classId);

    if (classIds.length > 0) {
      const today = new Date().toISOString().split('T')[0];

      // 查出要取消的課堂 IDs
      const { data: targetSessions, error: fetchError } = await supabase
        .from('sessions')
        .select('id')
        .eq('org_id', orgId)
        .in('class_id', classIds)
        .gte('session_date', today)
        .neq('status', 'completed');

      if (fetchError) {
        return c.json({ error: fetchError.message, code: 'DB_ERROR' }, 400);
      }

      const sessionIds = (targetSessions ?? []).map((r) => r['id'] as string);

      if (sessionIds.length > 0) {
        // 軟刪除：更新狀態為 cancelled
        const { error: updateError } = await supabase
          .from('sessions')
          .update({ status: 'cancelled' })
          .in('id', sessionIds);

        if (updateError) {
          return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
        }

        // 取得操作者名稱
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', userId)
          .maybeSingle();

        // 為每堂課建立 schedule_change 紀錄
        const changeRecords = sessionIds.map((sessionId) => ({
          org_id: orgId,
          session_id: sessionId,
          change_type: 'cancellation',
          reason: '課程停用',
          created_by_name: profile?.display_name ?? null,
        }));

        const { error: insertError } = await supabase
          .from('schedule_changes')
          .insert(changeRecords);

        if (insertError) {
          return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
        }

        cancelledFutureSessions = sessionIds.length;
      }
    }
  }

  logAudit(supabase, {
    orgId,
    userId,
    resourceType: 'course',
    resourceId: id,
    resourceName: data.name as string,
    action: 'update',
    details: {
      deactivateMode: body.deactivateMode ?? null,
      cancelledFutureSessions,
    },
  }, c.executionCtx.waitUntil.bind(c.executionCtx));

  return c.json(
    {
      data: mapCourse(data as Record<string, unknown>),
      ...(shouldCancelFutureSessions ? { cancelledFutureSessions } : {}),
    },
    200,
  );
});

// DELETE /api/courses/:id - 刪除課程
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Courses'],
  summary: '刪除課程',
  description: '刪除課程（僅限無開課班的課程）',
  request: {
    params: z.object({
      id: z.uuid(),
    }),
  },
  responses: {
    200: {
      description: '成功刪除課程',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    404: {
      description: '課程不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '課程有關聯的開課班，無法刪除',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  // Check for related classes
  const { count } = await supabase
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', id);

  if (count && count > 0) {
    return c.json(
      { error: `此課程有 ${count} 個開課班，無法刪除`, code: 'HAS_CLASSES' },
      409
    );
  }

  const { data: existing } = await supabase.from('courses').select('name').eq('id', id).single();

  const { error } = await supabase.from('courses').delete().eq('id', id);

  if (error) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  logAudit(supabase, {
    orgId,
    userId,
    resourceType: 'course',
    resourceId: id,
    resourceName: existing?.name ?? null,
    action: 'delete',
  }, c.executionCtx.waitUntil.bind(c.executionCtx));

  return c.json({ success: true }, 200);
});

export default app;
