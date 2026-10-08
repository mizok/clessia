import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { formatAuditCourseResourceName, logAudit } from '../utils/audit';
import { applyCampusFilter, getCampusScope, isCampusAllowed } from '../lib/campus-scope';
import { findInOrg, inOrg } from '../lib/org-scope';
import { DbUuidSchema } from '../lib/validation';

// ============================================================
// Schemas (with OpenAPI metadata)
// ============================================================

const CourseSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    campusId: DbUuidSchema,
    campusName: z.string().optional(),
    name: z.string(),
    subjectId: DbUuidSchema,
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
    summary: z.object({
      bySubject: z
        .array(
          z.object({
            subjectId: DbUuidSchema,
            subjectName: z.string(),
            count: z.number().int(),
          }),
        )
        .openapi({
          description:
            '各科目的課程數（依科目排序，含 0 門的科目）。跟列表同一個分校範圍，不吃 search／isActive／subjectId',
        }),
    }),
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
    campusId: DbUuidSchema.openapi({ description: '所屬分校 ID' }),
    name: z.string().min(1).max(50).openapi({ description: '課程名稱', example: '國一數學' }),
    subjectId: DbUuidSchema.openapi({ description: '科目 ID' }),
    description: z.string().max(500).nullable().optional().openapi({ description: '課程說明' }),
    gradeLevels: z.array(z.string()).min(1).openapi({ description: '適合年級' }),
  })
  .openapi('CreateCourse');

const UpdateCourseSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    subjectId: DbUuidSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    gradeLevels: z.array(z.string()).min(1).optional(),
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
  campusId: DbUuidSchema.optional().openapi({ description: '篩選分校' }),
  subjectId: DbUuidSchema.optional().openapi({ description: '篩選科目 ID' }),
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
    400: {
      description: '資料庫錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: '章節計數失敗',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(listRoute, async (c) => {
  const supabase = c.get('supabase');
  const query = c.req.valid('query');

  const page = Math.max(parseInt(query.page || '1'), 1);
  const rawPageSize = query.pageSize !== undefined ? parseInt(query.pageSize) : 20;
  const unpaginated = rawPageSize === 0;
  const pageSize = unpaginated ? 0 : Math.max(rawPageSize, 1);
  const offset = (page - 1) * pageSize;

  // Build query
  let dbQuery = supabase
    .from('courses')
    .select('*, campuses(name), subjects(name)', { count: 'exact' });

  // Apply filters
  if (query.search) {
    dbQuery = dbQuery.ilike('name', `%${query.search}%`);
  }
  dbQuery = applyCampusFilter(dbQuery, 'campus_id', getCampusScope(c), query.campusId);
  if (query.subjectId) {
    dbQuery = dbQuery.eq('subject_id', query.subjectId);
  }
  if (query.isActive !== undefined) {
    dbQuery = dbQuery.eq('is_active', query.isActive === 'true');
  }

  // Pagination
  dbQuery = dbQuery.order('created_at', { ascending: false });
  if (!unpaginated) dbQuery = dbQuery.range(offset, offset + pageSize - 1);

  const { data, count, error } = await dbQuery;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const courses = (data || []).map((row) => mapCourse(row as Record<string, unknown>));
  const total = count || 0;

  // 依科目分章的章節計數（#1314 C1）。每科一支 head count 讓 DB 數 —— 撈列回來數會被
  // max_rows（1000）靜默截斷。跟列表同一個分校範圍；**不吃 search／isActive／subjectId**
  // （同 parents summary 不受 status filter 影響），章名的數字是全體不是本次結果。
  // ⚠️ 帶 org_id：列表主查詢本身沒濾 org（#1398），這裡不跟著漏
  const orgId = c.get('orgId');
  const campusScope = getCampusScope(c);
  const { data: subjects, error: subjectsError } = await supabase
    .from('subjects')
    .select('id, name')
    .eq('org_id', orgId)
    .order('sort_order');
  if (subjectsError) {
    return c.json({ error: subjectsError.message, code: 'DB_ERROR' }, 500);
  }
  const subjectRows = (subjects ?? []) as Array<{ id: string; name: string }>;
  const subjectCounts = await Promise.all(
    subjectRows.map((subject) => {
      const countQuery = supabase
        .from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('subject_id', subject.id);
      return applyCampusFilter(countQuery, 'campus_id', campusScope, query.campusId);
    }),
  );
  // 數不出來就不回 0
  const countError = subjectCounts.find((r) => r.error)?.error;
  if (countError) {
    return c.json({ error: countError.message, code: 'DB_ERROR' }, 500);
  }
  const bySubject = subjectRows.map((subject, i) => ({
    subjectId: subject.id,
    subjectName: subject.name,
    count: subjectCounts[i]?.count ?? 0,
  }));

  // 必須明寫 200：不帶狀態碼時型別無法選中 200 分支，會去跟 400 的 error schema 比對而報錯。
  return c.json(
    {
      data: courses,
      summary: { bySubject },
      meta: {
        total,
        page: unpaginated ? 1 : page,
        pageSize: unpaginated ? total : pageSize,
        totalPages: unpaginated ? 1 : Math.ceil(total / pageSize),
      },
    },
    200,
  );
});

// GET /api/courses/:id - 取得單一課程
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Courses'],
  summary: '取得單一課程',
  request: {
    params: z.object({
      id: DbUuidSchema.openapi({ description: '課程 ID' }),
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

  return c.json(
    {
      data: mapCourse(data as Record<string, unknown>),
    },
    200,
  );
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
    403: {
      description: '沒有這個分校的權限',
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

  // 分校範圍在寫入路徑上也要成立 —— 沒有這段，只管 A 校的管理員可以在 B 校建課程，
  // **而且建完自己看不到**（讀取被範圍過濾），沒有人會發現它是誰建的。
  if (!isCampusAllowed(getCampusScope(c), body.campusId)) {
    return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
  }

  const { data, error } = await supabase
    .from('courses')
    .insert({
      org_id: orgId,
      campus_id: body.campusId,
      name: body.name,
      subject_id: body.subjectId,
      description: body.description || null,
      grade_levels: body.gradeLevels,
    })
    .select('*, campuses(name), subjects(name)')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '此分校已有同名課程', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'course',
      resourceId: data.id as string,
      resourceName: formatAuditCourseResourceName({
        courseName: data.name as string,
        campusName: (data.campuses as Record<string, unknown> | null)?.['name'] as string | null,
      }),
      action: 'create',
    },
    waitUntilFrom(c),
  );

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
      id: DbUuidSchema,
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

  // 別 org 的 id 跟不存在一樣回 404（c1，#966 B1）
  const existingCourse = await findInOrg(supabase, 'courses', orgId, id, 'id, is_active');

  if (!existingCourse) {
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
      const today = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Taipei',
      }).format(new Date());

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
        const { error: updateError } = await inOrg(
          supabase.from('sessions').update({ status: 'cancelled' }).in('id', sessionIds),
          orgId,
        );

        if (updateError) {
          return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
        }

        // 取得操作者名稱
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', userId)
          .maybeSingle();

        // 為每堂課建立 schedule_change 紀錄（整門課一次停用 = 一批，#1195；同班級停用）
        const batchId = crypto.randomUUID();
        const changeRecords = sessionIds.map((sessionId) => ({
          org_id: orgId,
          session_id: sessionId,
          operation_source: 'batch',
          batch_id: batchId,
          change_type: 'cancellation',
          reason: '課程停用',
          created_by_name: profile?.display_name ?? null,
        }));

        const { error: insertError } = await supabase
          .from('schedule_changes')
          .insert(changeRecords);

        if (insertError) {
          // Rollback sessions
          await inOrg(
            supabase.from('sessions').update({ status: 'scheduled' }).in('id', sessionIds),
            orgId,
          );
          return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
        }

        cancelledFutureSessions = sessionIds.length;
      }
    }
  }

  const { data, error } = await inOrg(
    supabase.from('courses').update(updateData).eq('id', id),
    orgId,
  )
    .select('*, campuses(name), subjects(name)')
    .single();

  if (error || !data) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'course',
      resourceId: id,
      resourceName: formatAuditCourseResourceName({
        courseName: data.name as string,
        campusName: (data.campuses as Record<string, unknown> | null)?.['name'] as string | null,
      }),
      action: 'update',
      details: {
        deactivateMode: body.deactivateMode ?? null,
        cancelledFutureSessions,
      },
    },
    waitUntilFrom(c),
  );

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
      id: DbUuidSchema,
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

  // 刪之前先讀（稽核要名字），同時是 org 範圍的存在檢查（c1，#966 B1）
  const existing = await findInOrg(supabase, 'courses', orgId, id, 'name, campuses(name)');
  if (!existing) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  // Check for related classes
  const { count } = await supabase
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', id);

  if (count && count > 0) {
    return c.json({ error: `此課程有 ${count} 個開課班，無法刪除`, code: 'HAS_CLASSES' }, 409);
  }

  const { error } = await inOrg(supabase.from('courses').delete().eq('id', id), orgId);

  if (error) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'course',
      resourceId: id,
      resourceName: formatAuditCourseResourceName({
        courseName: existing['name'] as string | null | undefined,
        campusName: (existing['campuses'] as Record<string, unknown> | null | undefined)?.[
          'name'
        ] as string | null,
      }),
      action: 'delete',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

export default app;
