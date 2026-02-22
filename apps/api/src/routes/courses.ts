import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

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
  })
  .openapi('CreateCourse');

const UpdateCourseSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    subjectId: z.uuid().optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
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
  const user = c.get('user');
  const body = c.req.valid('json');

  // Get user's org_id from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single();

  if (!profile?.org_id) {
    return c.json({ error: '無法取得組織資訊', code: 'NO_ORG' }, 400);
  }

  const { data, error } = await supabase
    .from('courses')
    .insert({
      org_id: profile.org_id,
      campus_id: body.campusId,
      name: body.name,
      subject_id: body.subjectId,
      description: body.description || null,
    })
    .select('*, campuses(name), subjects(name)')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '此分校已有同名課程', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

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
  },
});

app.openapi(updateRoute, async (c) => {
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData['name'] = body.name;
  if (body.subjectId !== undefined) updateData['subject_id'] = body.subjectId;
  if (body.description !== undefined) updateData['description'] = body.description;
  if (body.isActive !== undefined) updateData['is_active'] = body.isActive;

  const { data, error } = await supabase
    .from('courses')
    .update(updateData)
    .eq('id', id)
    .select('*, campuses(name), subjects(name)')
    .single();

  if (error || !data) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ data: mapCourse(data as Record<string, unknown>) }, 200);
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

  const { error } = await supabase.from('courses').delete().eq('id', id);

  if (error) {
    return c.json({ error: '課程不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ success: true }, 200);
});

export default app;
