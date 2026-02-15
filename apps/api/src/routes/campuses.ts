import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas (with OpenAPI metadata)
// ============================================================

const CampusSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Campus');

const CampusListResponseSchema = z
  .object({
    data: z.array(CampusSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('CampusListResponse');

const CreateCampusSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ description: '分校名稱', example: '台北信義校' }),
    address: z.string().max(255).nullable().optional().openapi({ description: '分校地址' }),
    phone: z.string().max(30).nullable().optional().openapi({ description: '分校電話' }),
    isActive: z.boolean().optional().openapi({ description: '是否啟用' }),
  })
  .openapi('CreateCampus');

const UpdateCampusSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    address: z.string().max(255).nullable().optional(),
    phone: z.string().max(30).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateCampus');

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
  search: z.string().optional().openapi({ description: '搜尋分校名稱' }),
  isActive: z.string().optional().openapi({ description: '篩選狀態 (true/false)' }),
});

// ============================================================
// Helper function to map DB row to Campus
// ============================================================

function mapCampus(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    address: row['address'] as string | null,
    phone: row['phone'] as string | null,
    isActive: row['is_active'] as boolean,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/campuses - 取得分校列表
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Campuses'],
  summary: '取得分校列表',
  description: '取得分校列表，支援分頁、搜尋、篩選',
  request: {
    query: QueryParamsSchema,
  },
  responses: {
    200: {
      description: '成功取得分校列表',
      content: {
        'application/json': {
          schema: CampusListResponseSchema,
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
  let dbQuery = supabase.from('campuses').select('*', { count: 'exact' });

  // Apply filters
  if (query.search) {
    dbQuery = dbQuery.ilike('name', `%${query.search}%`);
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

  const campuses = (data || []).map((row) => mapCampus(row as Record<string, unknown>));

  return c.json(
    {
      data: campuses,
      meta: {
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    },
    200
  );
});

// GET /api/campuses/:id - 取得單一分校
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Campuses'],
  summary: '取得單一分校',
  request: {
    params: z.object({
      id: z.uuid().openapi({ description: '分校 ID' }),
    }),
  },
  responses: {
    200: {
      description: '成功取得分校',
      content: {
        'application/json': {
          schema: z.object({ data: CampusSchema }),
        },
      },
    },
    404: {
      description: '分校不存在',
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

  const { data, error } = await supabase.from('campuses').select('*').eq('id', id).single();

  if (error || !data) {
    return c.json({ error: '分校不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json(
    {
      data: mapCampus(data as Record<string, unknown>),
    },
    200
  );
});

// POST /api/campuses - 新增分校
const createCampusRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Campuses'],
  summary: '新增分校',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateCampusSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: '成功新增分校',
      content: {
        'application/json': {
          schema: z.object({ data: CampusSchema }),
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
      description: '分校名稱重複',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(createCampusRoute, async (c) => {
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

  const insertData: Record<string, unknown> = {
    org_id: profile.org_id,
    name: body.name,
    address: body.address || null,
    phone: body.phone || null,
  };

  if (body.isActive !== undefined) {
    insertData['is_active'] = body.isActive;
  }

  const { data, error } = await supabase.from('campuses').insert(insertData).select('*').single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '此組織已有同名分校', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ data: mapCampus(data as Record<string, unknown>) }, 201);
});

// PUT /api/campuses/:id - 更新分校
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Campuses'],
  summary: '更新分校',
  request: {
    params: z.object({
      id: z.uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateCampusSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功更新分校',
      content: {
        'application/json': {
          schema: z.object({ data: CampusSchema }),
        },
      },
    },
    404: {
      description: '分校不存在',
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
  if (body.address !== undefined) updateData['address'] = body.address;
  if (body.phone !== undefined) updateData['phone'] = body.phone;
  if (body.isActive !== undefined) updateData['is_active'] = body.isActive;

  const { data, error } = await supabase
    .from('campuses')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    return c.json({ error: '分校不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ data: mapCampus(data as Record<string, unknown>) }, 200);
});

// DELETE /api/campuses/:id - 刪除分校
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Campuses'],
  summary: '刪除分校',
  description: '刪除分校（僅限無課程的分校）',
  request: {
    params: z.object({
      id: z.uuid(),
    }),
  },
  responses: {
    200: {
      description: '成功刪除分校',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    404: {
      description: '分校不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '分校有關聯的課程，無法刪除',
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

  // Check for related courses
  const { count } = await supabase
    .from('courses')
    .select('id', { count: 'exact', head: true })
    .eq('campus_id', id);

  if (count && count > 0) {
    return c.json(
      { error: `此分校有 ${count} 個課程，無法刪除`, code: 'HAS_COURSES' },
      409
    );
  }

  const { error } = await supabase.from('campuses').delete().eq('id', id);

  if (error) {
    return c.json({ error: '分校不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ success: true }, 200);
});

export default app;
