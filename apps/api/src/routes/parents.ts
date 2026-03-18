import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createAuth } from '../auth';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';

// ============================================================
// Schemas
// ============================================================

const ParentStatusSchema = z.enum(['active', 'inactive', 'archived']).openapi('ParentStatus');

const ParentSchema = z
  .object({
    id: z.uuid(),
    userId: z.string(), // ba_user.id is text, not uuid
    orgId: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    loginAccount: z.string(), // email 優先，否則 phone
    status: ParentStatusSchema,
    studentCount: z.number(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Parent');

const ParentDetailStudentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    grade: z.string(),
    relation: z.string().nullable(),
    isPrimary: z.boolean(),
  })
  .openapi('ParentDetailStudent');

const ParentDetailSchema = ParentSchema.extend({
  students: z.array(ParentDetailStudentSchema),
}).openapi('ParentDetail');

const ParentListResponseSchema = z
  .object({
    data: z.array(ParentSchema),
    summary: z.object({
      total: z.number(),
      activeCount: z.number(),
      inactiveCount: z.number(),
      archivedCount: z.number(),
    }),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('ParentListResponse');

const CreateParentSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: z.email().optional(),
    phone: z.string().max(20).optional(),
    studentIds: z.array(z.uuid()).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi('CreateParent');

const UpdateParentSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    email: z.email().nullable().optional(),
    phone: z.string().max(20).nullable().optional(),
    studentIds: z.array(z.uuid()).optional(), // 全量替換；[] 表示解除所有關聯
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi('UpdateParent');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('ParentError');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function generateRandomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function toParentResponse(
  row: Record<string, unknown>,
  studentCount = 0,
  baUser?: { email: string | null; phone: string | null },
) {
  const email = baUser?.email ?? (row['email'] as string | null) ?? null;
  const phone = baUser?.phone ?? (row['phone'] as string | null) ?? null;
  return {
    id: row['id'] as string,
    userId: row['user_id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    phone,
    email,
    loginAccount: email ?? phone ?? '',
    status: row['status'] as string,
    studentCount,
    notes: (row['notes'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function isDuplicateEmailError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes('already') && normalized.includes('registered')) ||
    normalized.includes('email_exists') ||
    normalized.includes('email already')
  );
}

function isDuplicateUsernameError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes('username') &&
      (normalized.includes('taken') || normalized.includes('already'))) ||
    normalized.includes('username_exists')
  );
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/parents
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Parents'],
    summary: '取得家長列表',
    request: {
      query: z.object({
        search: z.string().optional(),
        status: ParentStatusSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '家長列表',
        content: { 'application/json': { schema: ParentListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { search, status, page = 1, pageSize = 20 } = c.req.valid('query');
    const offset = (page - 1) * pageSize;

    // 計算 student counts
    const { data: relCounts } = await supabase
      .from('parent_student_relations')
      .select('parent_id')
      .in(
        'parent_id',
        (
          await supabase.from('parents').select('id').eq('org_id', orgId)
        ).data?.map((p: { id: string }) => p.id) ?? [],
      );

    const studentCountMap = new Map<string, number>();
    for (const rel of relCounts ?? []) {
      const r = rel as { parent_id: string };
      studentCountMap.set(r.parent_id, (studentCountMap.get(r.parent_id) ?? 0) + 1);
    }

    let query = supabase
      .from('parents')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('name');

    if (search) {
      const { data: baMatches } = await supabase
        .from('ba_user')
        .select('id')
        .or(`email.ilike.%${search}%,phone.ilike.%${search}%`);
      const matchingUserIds = (baMatches ?? []).map((u: { id: string }) => u.id);

      if (matchingUserIds.length > 0) {
        query = query.or(`name.ilike.%${search}%,user_id.in.(${matchingUserIds.join(',')})`);
      } else {
        query = query.ilike('name', `%${search}%`);
      }
    }
    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取家長列表失敗', message: error.message }, 500);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const userIds = rows.map((r) => r['user_id'] as string).filter(Boolean);
    const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
    if (userIds.length > 0) {
      const { data: baUsers } = await supabase.from('ba_user').select('id, email, phone').in('id', userIds);
      for (const u of baUsers ?? []) {
        baUserMap.set(u.id as string, {
          email: (u.email as string | null) ?? null,
          phone: (u.phone as string | null) ?? null,
        });
      }
    }
    const total = count ?? 0;

    const parents = rows.map((row) =>
      toParentResponse(
        row,
        studentCountMap.get(row['id'] as string) ?? 0,
        baUserMap.get(row['user_id'] as string),
      ),
    );

    // Summary（不受 status filter 影響）
    const { data: summaryRows } = await supabase
      .from('parents')
      .select('status')
      .eq('org_id', orgId);

    const summaryList = (summaryRows ?? []) as Array<{ status: string }>;
    const summaryTotal = summaryList.length;
    const activeCount = summaryList.filter((r) => r.status === 'active').length;
    const inactiveCount = summaryList.filter((r) => r.status === 'inactive').length;
    const archivedCount = summaryList.filter((r) => r.status === 'archived').length;

    return c.json(
      {
        data: parents,
        summary: { total: summaryTotal, activeCount, inactiveCount, archivedCount },
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/parents
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Parents'],
    summary: '新增家長（同步建立 BA user）',
    request: {
      body: { content: { 'application/json': { schema: CreateParentSchema } } },
    },
    responses: {
      201: {
        description: '建立成功',
        content: {
          'application/json': {
            schema: z.object({ data: ParentSchema, initialPassword: z.string() }),
          },
        },
      },
      400: { description: '資料驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: '重複帳號', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    if (!body.email && !body.phone) {
      return c.json({ error: 'Email 或手機號碼至少填一個', code: 'EMAIL_OR_PHONE_REQUIRED' }, 400);
    }

    const auth = createAuth(c.env);
    const password = generateRandomPassword();
    let createdUserId: string | null = null;

    try {
      const newUser = await (auth.api as any).createUser({
        body: {
          name: body.name,
          email: body.email ?? undefined,
          phone: body.phone ?? undefined,
          // Phone-only accounts use phone as username so signInUsername can look them up
          username: !body.email && body.phone ? body.phone : undefined,
          password,
        },
        asResponse: false,
      });
      createdUserId = newUser.user.id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isDuplicateEmailError(msg)) {
        return c.json({ error: 'Email 已被使用', code: 'DUPLICATE_EMAIL' }, 409);
      }
      if (isDuplicateUsernameError(msg)) {
        return c.json({ error: '此手機已被使用', code: 'DUPLICATE_PHONE' }, 409);
      }
      return c.json({ error: msg || '建立帳號失敗', code: 'CREATE_AUTH_USER_FAILED' }, 400);
    }

    const rollback = async () => {
      if (!createdUserId) return;
      try {
        await auth.api.removeUser({ body: { userId: createdUserId }, asResponse: false });
      } catch {
        // ignore rollback errors
      }
    };

    // 更新 orgId
    const { error: updateOrgError } = await supabase
      .from('ba_user')
      .update({ orgId })
      .eq('id', createdUserId);

    if (updateOrgError) {
      await rollback();
      return c.json({ error: updateOrgError.message, code: 'UPDATE_USER_ORG_FAILED' }, 400);
    }

    // INSERT parents
    const { data: parentRow, error: insertError } = await supabase
      .from('parents')
      .insert({
        user_id: createdUserId,
        org_id: orgId,
        name: body.name,
        notes: body.notes ?? null,
        status: 'active',
      })
      .select('*')
      .single();

    if (insertError || !parentRow) {
      await rollback();
      return c.json({ error: '建立家長資料失敗', code: 'CREATE_PARENT_FAILED' }, 400);
    }

    // INSERT parent_student_relations
    if (body.studentIds?.length) {
      const relations = body.studentIds.map((sid) => ({
        parent_id: (parentRow as Record<string, unknown>)['id'] as string,
        student_id: sid,
        is_primary: false,
        relation: null,
      }));
      const { error: relError } = await supabase
        .from('parent_student_relations')
        .insert(relations);
      if (relError) {
        await supabase
          .from('parents')
          .delete()
          .eq('id', (parentRow as Record<string, unknown>)['id'] as string);
        await rollback();
        return c.json({ error: relError.message, code: 'CREATE_RELATIONS_FAILED' }, 400);
      }
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'parent',
        resourceId: (parentRow as Record<string, unknown>)['id'] as string,
        resourceName: body.name,
        action: 'create',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json(
      {
        data: toParentResponse(parentRow as Record<string, unknown>, 0),
        initialPassword: password,
      },
      201,
    );
  },
);

// GET /api/parents/:id
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Parents'],
    summary: '取得家長詳情（含關聯學生）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '家長詳情',
        content: { 'application/json': { schema: z.object({ data: ParentDetailSchema }) } },
      },
      404: { description: '家長不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data, error } = await supabase
      .from('parents')
      .select(
        `*, parent_student_relations(
          id, is_primary, relation,
          students(id, name, grade)
        )`,
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error || !data) {
      return c.json({ error: '家長不存在', code: 'NOT_FOUND' }, 404);
    }

    const row = data as Record<string, unknown>;
    const { data: baUserData } = await supabase
      .from('ba_user')
      .select('email, phone')
      .eq('id', row['user_id'] as string)
      .maybeSingle();
    const baUser = baUserData
      ? { email: baUserData.email as string | null, phone: baUserData.phone as string | null }
      : undefined;
    const relations = (
      row['parent_student_relations'] as Array<{
        id: string;
        is_primary: boolean;
        relation: string | null;
        students: { id: string; name: string; grade: string } | null;
      }>
    ) ?? [];

    const students = relations
      .filter((r) => r.students)
      .map((r) => ({
        id: r.students!.id,
        name: r.students!.name,
        grade: r.students!.grade,
        relation: r.relation,
        isPrimary: r.is_primary,
      }));

    return c.json(
      { data: { ...toParentResponse(row, students.length, baUser), students } },
      200,
    );
  },
);

// PUT /api/parents/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Parents'],
    summary: '更新家長基本資料 + 關聯學生',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateParentSchema } } },
    },
    responses: {
      200: {
        description: '更新成功',
        content: { 'application/json': { schema: z.object({ data: ParentSchema }) } },
      },
      400: { description: '更新失敗', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '家長不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // 確認家長存在
    const { data: existing, error: fetchError } = await supabase
      .from('parents')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !existing) {
      return c.json({ error: '家長不存在', code: 'NOT_FOUND' }, 404);
    }

    const existingRow = existing as Record<string, unknown>;

    // 更新 parents 表
    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload['name'] = body.name;
    if (body.notes !== undefined) updatePayload['notes'] = body.notes;

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase
        .from('parents')
        .update(updatePayload)
        .eq('id', id);
      if (updateError) {
        return c.json({ error: updateError.message, code: 'UPDATE_PARENT_FAILED' }, 400);
      }
    }

    // 同步 ba_user email/username
    const auth = createAuth(c.env);
    const userId = existingRow['user_id'] as string;

    if (body.email !== undefined) {
      try {
        await auth.api.updateUser({
          body: { userId, email: body.email ?? undefined },
          asResponse: false,
        });
      } catch {
        // best effort - 若 email 重複在這裡會拋錯
      }
    }

    if (body.phone !== undefined) {
      await supabase.from('ba_user').update({ phone: body.phone }).eq('id', userId);
    }

    // studentIds 全量替換
    if (body.studentIds !== undefined) {
      await supabase.from('parent_student_relations').delete().eq('parent_id', id);
      if (body.studentIds.length > 0) {
        const relations = body.studentIds.map((sid) => ({
          parent_id: id,
          student_id: sid,
          is_primary: false,
          relation: null,
        }));
        const { error: relError } = await supabase
          .from('parent_student_relations')
          .insert(relations);
        if (relError) {
          return c.json({ error: relError.message, code: 'UPDATE_RELATIONS_FAILED' }, 400);
        }
      }
    }

    // 讀取更新後的資料
    const { data: updatedRow, error: readError } = await supabase
      .from('parents')
      .select('*')
      .eq('id', id)
      .single();

    if (readError || !updatedRow) {
      return c.json({ error: '讀取更新後資料失敗', code: 'READ_AFTER_UPDATE_FAILED' }, 400);
    }

    // 計算 student count
    const { count: studentCount } = await supabase
      .from('parent_student_relations')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', id);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'parent',
        resourceId: id,
        resourceName: (updatedRow as Record<string, unknown>)['name'] as string,
        action: 'update',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json(
      { data: toParentResponse(updatedRow as Record<string, unknown>, studentCount ?? 0) },
      200,
    );
  },
);

// POST /api/parents/:id/reset-password
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/reset-password',
    tags: ['Parents'],
    summary: '重設家長密碼（管理員操作，回傳新密碼）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '重設成功',
        content: { 'application/json': { schema: z.object({ password: z.string() }) } },
      },
      404: { description: '家長不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data: parentRow, error } = await supabase
      .from('parents')
      .select('user_id, name')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error || !parentRow) {
      return c.json({ error: '家長不存在', code: 'NOT_FOUND' }, 404);
    }

    const auth = createAuth(c.env);
    const newPassword = generateRandomPassword();
    const userId = (parentRow as Record<string, unknown>)['user_id'] as string;

    try {
      await auth.api.setPassword({
        body: { userId, password: newPassword },
        asResponse: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg || '重設密碼失敗', code: 'RESET_PASSWORD_FAILED' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'parent',
        resourceId: id,
        resourceName: (parentRow as Record<string, unknown>)['name'] as string,
        action: 'reset_password',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ password: newPassword }, 200);
  },
);

// PATCH /api/parents/:id/activate
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/activate',
    tags: ['Parents'],
    summary: '啟用家長帳號（inactive → active）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '啟用成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      400: { description: '啟用失敗', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '家長不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data: parentRow, error: fetchError } = await supabase
      .from('parents')
      .select('user_id, name, status')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !parentRow) {
      return c.json({ error: '家長不存在', code: 'NOT_FOUND' }, 404);
    }

    const { error: updateError } = await supabase
      .from('parents')
      .update({ status: 'active' })
      .eq('id', id);

    if (updateError) {
      return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'parent',
        resourceId: id,
        resourceName: (parentRow as Record<string, unknown>)['name'] as string,
        action: 'activate',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ success: true }, 200);
  },
);

// PATCH /api/parents/:id/deactivate
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/deactivate',
    tags: ['Parents'],
    summary: '停用家長帳號（active → inactive）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '停用成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      400: { description: '停用失敗', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '家長不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data: parentRow, error: fetchError } = await supabase
      .from('parents')
      .select('user_id, name')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !parentRow) {
      return c.json({ error: '家長不存在', code: 'NOT_FOUND' }, 404);
    }

    const { error: updateError } = await supabase
      .from('parents')
      .update({ status: 'inactive' })
      .eq('id', id);

    if (updateError) {
      return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'parent',
        resourceId: id,
        resourceName: (parentRow as Record<string, unknown>)['name'] as string,
        action: 'deactivate',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ success: true }, 200);
  },
);

// PATCH /api/parents/:id/archive
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/archive',
    tags: ['Parents'],
    summary: '封存家長帳號（單向，無法透過 API 解除）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '封存成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      400: { description: '封存失敗', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '家長不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data: parentRow, error: fetchError } = await supabase
      .from('parents')
      .select('user_id, name, status')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (fetchError || !parentRow) {
      return c.json({ error: '家長不存在', code: 'NOT_FOUND' }, 404);
    }

    const currentStatus = (parentRow as Record<string, unknown>)['status'] as string;
    if (currentStatus === 'archived') {
      return c.json({ error: '家長已封存', code: 'ALREADY_ARCHIVED' }, 400);
    }

    const { error: updateError } = await supabase
      .from('parents')
      .update({ status: 'archived' })
      .eq('id', id);

    if (updateError) {
      return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'parent',
        resourceId: id,
        resourceName: (parentRow as Record<string, unknown>)['name'] as string,
        action: 'archive',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ success: true }, 200);
  },
);

export default app;
