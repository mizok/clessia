import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const SubjectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    sortOrder: z.number().int(),
  })
  .openapi('Subject');

const SubjectListResponseSchema = z
  .object({
    data: z.array(SubjectSchema),
  })
  .openapi('SubjectListResponse');

const CreateSubjectSchema = z
  .object({
    name: z.string().min(1, '請輸入科目名稱').max(50, '科目名稱不可超過 50 個字元').openapi({ example: '物理' }),
  })
  .openapi('CreateSubject');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('Error');

const app = new OpenAPIHono<AppEnv>();

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Subjects'],
  summary: '取得科目列表',
  description: '取得目前使用者所屬組織的科目列表',
  responses: {
    200: {
      description: '成功取得科目列表',
      content: {
        'application/json': {
          schema: SubjectListResponseSchema,
        },
      },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(listRoute, async (c) => {
  const supabase = c.get('supabase');
  const user = c.get('user');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.org_id) {
    return c.json({ error: '無法取得組織資訊', code: 'NO_ORG' }, 400);
  }

  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, sort_order')
    .eq('org_id', profile.org_id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  return c.json(
    {
      data: (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
      })),
    },
    200,
  );
});

// PUT /api/subjects/:id - 更新科目名稱
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Subjects'],
  summary: '更新科目名稱',
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      content: {
        'application/json': { schema: CreateSubjectSchema },
      },
    },
  },
  responses: {
    200: {
      description: '成功更新科目',
      content: { 'application/json': { schema: z.object({ data: SubjectSchema }) } },
    },
    400: { description: '錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '科目不存在', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(updateRoute, async (c) => {
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('subjects')
    .update({ name: body.name.trim() })
    .eq('id', id)
    .select('id, name, sort_order')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '科目名稱已存在', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: '科目不存在', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ data: { id: data.id, name: data.name, sortOrder: data.sort_order } }, 200);
});

// DELETE /api/subjects/:id - 刪除科目
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Subjects'],
  summary: '刪除科目',
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    200: {
      description: '成功刪除',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: '錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    409: {
      description: '科目已被課程使用，無法刪除',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');

  // 確認有無課程使用此科目（ON DELETE RESTRICT）
  const { count } = await supabase
    .from('courses')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', id);

  if (count && count > 0) {
    return c.json({ error: `此科目有 ${count} 門課程使用中，無法刪除`, code: 'IN_USE' }, 409);
  }

  const { error } = await supabase.from('subjects').delete().eq('id', id);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ success: true }, 200);
});

const createSubjectRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Subjects'],
  summary: '新增科目',
  request: {
    body: {
      content: {
        'application/json': { schema: CreateSubjectSchema },
      },
    },
  },
  responses: {
    201: {
      description: '成功新增科目',
      content: {
        'application/json': {
          schema: z.object({ data: SubjectSchema }),
        },
      },
    },
    400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '科目名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(createSubjectRoute, async (c) => {
  const supabase = c.get('supabase');
  const user = c.get('user');
  const body = c.req.valid('json');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.org_id) {
    return c.json({ error: '無法取得組織資訊', code: 'NO_ORG' }, 400);
  }

  const { count: maxOrder } = await supabase
    .from('subjects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', profile.org_id);

  const { data, error } = await supabase
    .from('subjects')
    .insert({ org_id: profile.org_id, name: body.name.trim(), sort_order: maxOrder ?? 99 })
    .select('id, name, sort_order')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '科目名稱已存在', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ data: { id: data.id, name: data.name, sortOrder: data.sort_order } }, 201);
});

export default app;
