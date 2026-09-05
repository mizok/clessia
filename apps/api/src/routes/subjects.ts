import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { countSubjectUsage } from '../lib/subject-usage';

const SubjectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    sortOrder: z.number().int(),
    /**
     * 這個科目被幾門課程用著（`courses.subject_id` 是 `ON DELETE RESTRICT`，
     * DB 本身就會擋刪除，這個數字是給前端事先灰掉刪除按鈕、不用等 409 才知道）。
     */
    courseCount: z.number().int().min(0),
    /**
     * 這個科目被幾筆校內考用著（`academy_exams.subject_id` 是
     * `ON DELETE SET NULL`——**DB 不會擋，會安靜把欄位清掉**）。
     * 前端事先看得到這個數字，才做得出跟 `Student.hasEnrollments` 同樣的
     * 「灰掉 + 說原因」，不是只能事後被 409 拒絕。
     */
    academyExamCount: z.number().int().min(0),
  })
  .openapi('Subject');

const SubjectListResponseSchema = z
  .object({
    data: z.array(SubjectSchema),
  })
  .openapi('SubjectListResponse');

const CreateSubjectSchema = z
  .object({
    name: z
      .string()
      .min(1, '請輸入科目名稱')
      .max(50, '科目名稱不可超過 50 個字元')
      .openapi({ example: '物理' }),
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
  const orgId = c.get('orgId');

  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, sort_order')
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const subjectIds = (data ?? []).map((row) => row.id);

  // 批次算兩個用量來源，不是每個科目各發一次查詢 —— 讓前端事先看得到用量
  // 才做得出跟 Student.hasEnrollments 一樣的「灰掉 + 說原因」，不是只能事後 409。
  const [courseUsage, examUsage] = await Promise.all([
    countSubjectUsage({ supabase, orgId, table: 'courses', subjectIds }),
    countSubjectUsage({ supabase, orgId, table: 'academy_exams', subjectIds }),
  ]);

  if (courseUsage.error || examUsage.error) {
    return c.json({ error: '讀取科目用量失敗', code: 'USAGE_CHECK_FAILED' }, 400);
  }

  return c.json(
    {
      data: (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
        courseCount: courseUsage.counts.get(row.id) ?? 0,
        academyExamCount: examUsage.counts.get(row.id) ?? 0,
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
  const orgId = c.get('orgId');
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

  const [courseUsage, examUsage] = await Promise.all([
    countSubjectUsage({ supabase, orgId, table: 'courses', subjectIds: [id] }),
    countSubjectUsage({ supabase, orgId, table: 'academy_exams', subjectIds: [id] }),
  ]);

  if (courseUsage.error || examUsage.error) {
    return c.json({ error: '讀取科目用量失敗', code: 'USAGE_CHECK_FAILED' }, 400);
  }

  return c.json(
    {
      data: {
        id: data.id,
        name: data.name,
        sortOrder: data.sort_order,
        courseCount: courseUsage.counts.get(id) ?? 0,
        academyExamCount: examUsage.counts.get(id) ?? 0,
      },
    },
    200,
  );
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
      description: '科目已被課程或校內考使用，無法刪除',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: '用量守門查詢失敗 —— 拒絕刪除（fail closed）',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  // `courses.subject_id` 是 ON DELETE RESTRICT，DB 本身就會擋，這裡查是為了
  // 給友善訊息（說出被幾門課程用著）。
  const courseUsage = await countSubjectUsage({
    supabase,
    orgId,
    table: 'courses',
    subjectIds: [id],
  });

  // 查詢失敗一律 fail closed —— 不確定有沒有課程在用時，不准刪。
  if (courseUsage.error) {
    return c.json({ error: 'SUBJECT_USAGE_CHECK_FAILED', code: 'SUBJECT_USAGE_CHECK_FAILED' }, 500);
  }

  const courseCount = courseUsage.counts.get(id) ?? 0;
  if (courseCount > 0) {
    return c.json(
      { error: `此科目有 ${courseCount} 門課程使用中，無法刪除`, code: 'IN_USE_COURSES' },
      409,
    );
  }

  // `academy_exams.subject_id` 是 ON DELETE SET NULL —— DB 不會擋，會安靜把
  // 欄位清掉（M8 稽核發現：舊版完全沒查這張表）。這道檢查是這個關聯**唯一**
  // 的防線，不是第二道，所以一樣 fail closed。
  const examUsage = await countSubjectUsage({
    supabase,
    orgId,
    table: 'academy_exams',
    subjectIds: [id],
  });

  if (examUsage.error) {
    return c.json({ error: 'SUBJECT_USAGE_CHECK_FAILED', code: 'SUBJECT_USAGE_CHECK_FAILED' }, 500);
  }

  const examCount = examUsage.counts.get(id) ?? 0;
  if (examCount > 0) {
    return c.json(
      {
        error: `此科目有 ${examCount} 筆校內考使用中，無法刪除，請先修改那些考試的科目設定`,
        code: 'IN_USE_ACADEMY_EXAMS',
      },
      409,
    );
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
  const orgId = c.get('orgId');
  const body = c.req.valid('json');

  const { count: maxOrder } = await supabase
    .from('subjects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);

  const { data, error } = await supabase
    .from('subjects')
    .insert({ org_id: orgId, name: body.name.trim(), sort_order: maxOrder ?? 99 })
    .select('id, name, sort_order')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '科目名稱已存在', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  return c.json(
    {
      // 剛建立的科目不可能有任何用量 —— 不用查，直接是 0
      data: {
        id: data.id,
        name: data.name,
        sortOrder: data.sort_order,
        courseCount: 0,
        academyExamCount: 0,
      },
    },
    201,
  );
});

export default app;
