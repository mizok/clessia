import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';

export function buildSchoolListQuery(params: { search?: string; isActive?: boolean }): {
  searchFilter: string | null;
  isActiveFilter: boolean | null;
} {
  const search = params.search?.trim();
  const searchFilter = search ? `name.ilike.%${search}%,short_name.ilike.%${search}%` : null;
  const isActiveFilter = params.isActive ?? null;

  return { searchFilter, isActiveFilter };
}

const app = new OpenAPIHono<AppEnv>();

const SchoolSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    shortName: z.string().nullable(),
    isActive: z.boolean(),
    studentCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('School');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('SchoolError');

const ListResponseSchema = z
  .object({
    data: z.array(SchoolSchema),
    meta: z.object({ total: z.number().int().min(0) }),
  })
  .openapi('SchoolListResponse');

const CreateSchoolSchema = z
  .object({
    name: z.string().min(1).max(100),
    shortName: z.string().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('CreateSchool');

const UpdateSchoolSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    shortName: z.string().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateSchool');

interface SchoolWithCountRow {
  id: string;
  name: string;
  short_name: string | null;
  is_active: boolean;
  students: Array<{ count: number | null }> | null;
  created_at: string;
  updated_at: string;
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Schools'],
  summary: '列出就讀學校',
  request: {
    query: z.object({
      search: z.string().optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: ListResponseSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const { search, isActive } = c.req.valid('query');
  const { searchFilter, isActiveFilter } = buildSchoolListQuery({ search, isActive });

  let query = supabase
    .from('schools')
    .select('id, name, short_name, is_active, created_at, updated_at, students(count)', {
      count: 'exact',
    })
    .eq('org_id', orgId)
    .order('name', { ascending: true });

  if (searchFilter) query = query.or(searchFilter);
  if (isActiveFilter !== null) query = query.eq('is_active', isActiveFilter);

  const { data, error, count } = await query;
  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 400);

  const rows = ((data ?? []) as SchoolWithCountRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    isActive: row.is_active,
    studentCount: Array.isArray(row.students) ? (row.students[0]?.count ?? 0) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({ data: rows, meta: { total: count ?? rows.length } }, 200);
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Schools'],
  summary: '建立學校',
  request: { body: { content: { 'application/json': { schema: CreateSchoolSchema } } } },
  responses: {
    201: {
      description: '建立成功',
      content: { 'application/json': { schema: z.object({ data: SchoolSchema }) } },
    },
    409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(createRouteDef, async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('schools')
    .insert({
      org_id: orgId,
      name: body.name.trim(),
      short_name: body.shortName?.trim() || null,
      is_active: body.isActive ?? true,
    })
    .select('id, name, short_name, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') return c.json({ error: '學校名稱重複', code: 'DUPLICATE' }, 409);
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school',
      resourceId: data.id,
      resourceName: data.name,
      action: 'school.create',
      details: {},
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json(
    {
      data: {
        id: data.id,
        name: data.name,
        shortName: data.short_name,
        isActive: data.is_active,
        studentCount: 0,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    201,
  );
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Schools'],
  summary: '更新學校',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: { content: { 'application/json': { schema: UpdateSchoolSchema } } },
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(updateRouteDef, async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const payload: Record<string, unknown> = {};
  if (body.name !== undefined) payload['name'] = body.name.trim();
  if (body.shortName !== undefined) payload['short_name'] = body.shortName?.trim() || null;
  if (body.isActive !== undefined) payload['is_active'] = body.isActive;
  if (Object.keys(payload).length === 0) return c.json({ success: true }, 200);

  const { data, error } = await supabase
    .from('schools')
    .update(payload)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, name')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return c.json({ error: '找不到學校', code: 'NOT_FOUND' }, 404);
    if (error.code === '23505') return c.json({ error: '學校名稱重複', code: 'DUPLICATE' }, 409);
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }
  if (!data) return c.json({ error: '找不到學校', code: 'NOT_FOUND' }, 404);

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school',
      resourceId: id,
      resourceName: data.name,
      action: 'school.update',
      details: payload,
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true }, 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Schools'],
  summary: '刪除學校（需無學生關聯）',
  request: { params: z.object({ id: DbUuidSchema }) },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '仍有學生關聯', content: { 'application/json': { schema: ErrorSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(deleteRouteDef, async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');

  const { count: studentCount, error: studentCountError } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', id);

  if (studentCountError) return c.json({ error: studentCountError.message, code: 'DB_ERROR' }, 400);
  if ((studentCount ?? 0) > 0) {
    return c.json({ error: '此學校仍有學生關聯，無法刪除', code: 'CONSTRAINT' }, 409);
  }

  const { count: schoolExamCount, error: schoolExamCountError } = await supabase
    .from('school_exams')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', id);

  if (schoolExamCountError)
    return c.json({ error: schoolExamCountError.message, code: 'DB_ERROR' }, 400);
  if ((schoolExamCount ?? 0) > 0) {
    return c.json({ error: '此學校仍有學校考試事件，無法刪除', code: 'CONSTRAINT' }, 409);
  }

  const { data, error } = await supabase
    .from('schools')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, name')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return c.json({ error: '找不到學校', code: 'NOT_FOUND' }, 404);
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }
  if (!data) return c.json({ error: '找不到學校', code: 'NOT_FOUND' }, 404);

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school',
      resourceId: id,
      resourceName: data.name,
      action: 'school.delete',
      details: {},
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true }, 200);
});

export default app;
