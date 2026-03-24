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
    studentNames: z.array(z.string()), // 關聯學生姓名列表
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
  studentNames: string[] = [],
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
    status: row['status'] as 'active' | 'inactive' | 'archived',
    studentCount,
    studentNames,
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
      500: {
        description: '伺服器錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { search, status, page = 1, pageSize = 20 } = c.req.valid('query');
    const offset = (page - 1) * pageSize;

    // 取得 org 下所有 parent 的 id，用來查 student 關聯
    const { data: allParentIds } = await supabase
      .from('parents')
      .select('id')
      .eq('org_id', orgId);
    const parentIdList = (allParentIds ?? []).map((p: { id: string }) => p.id);

    // 取得 student relations（含學生姓名）
    const studentRelMap = new Map<string, Array<{ id: string; name: string }>>();
    if (parentIdList.length > 0) {
      const { data: relRows } = await supabase
        .from('parent_student_relations')
        .select('parent_id, students(id, name)')
        .in('parent_id', parentIdList);
      for (const rel of relRows ?? []) {
        const r = rel as unknown as { parent_id: string; students: { id: string; name: string } | null };
        if (!r.students) continue;
        const existing = studentRelMap.get(r.parent_id) ?? [];
        existing.push(r.students);
        studentRelMap.set(r.parent_id, existing);
      }
    }

    let query = supabase
      .from('parents')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('name');

    if (search) {
      // 搜尋 ba_user email/phone
      const { data: baMatches } = await supabase
        .from('ba_user')
        .select('id')
        .or(`email.ilike.%${search}%,phone.ilike.%${search}%`);
      const matchingUserIds = (baMatches ?? []).map((u: { id: string }) => u.id);

      // 搜尋學生姓名 → 找到對應的 parent_id
      const { data: studentMatches } = await supabase
        .from('students')
        .select('id')
        .eq('org_id', orgId)
        .ilike('name', `%${search}%`);
      const matchingStudentIds = (studentMatches ?? []).map((s: { id: string }) => s.id);
      let parentIdsFromStudents: string[] = [];
      if (matchingStudentIds.length > 0) {
        const { data: relMatches } = await supabase
          .from('parent_student_relations')
          .select('parent_id')
          .in('student_id', matchingStudentIds);
        parentIdsFromStudents = [...new Set((relMatches ?? []).map((r: { parent_id: string }) => r.parent_id))];
      }

      const orParts: string[] = [`name.ilike.%${search}%`];
      if (matchingUserIds.length > 0) orParts.push(`user_id.in.(${matchingUserIds.join(',')})`);
      if (parentIdsFromStudents.length > 0) orParts.push(`id.in.(${parentIdsFromStudents.join(',')})`);
      query = query.or(orParts.join(','));
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

    const parents = rows.map((row) => {
      const parentStudents = studentRelMap.get(row['id'] as string) ?? [];
      return toParentResponse(
        row,
        parentStudents.length,
        baUserMap.get(row['user_id'] as string),
        parentStudents.map((s) => s.name),
      );
    });

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
      { data: { ...toParentResponse(row, students.length, baUser, students.map((s) => s.name)), students } },
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

    if (body.email !== undefined && body.email !== null) {
      // 直接更新 ba_user email（best effort，忽略重複 email 錯誤）
      await supabase.from('ba_user').update({ email: body.email }).eq('id', userId);
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

    // 計算 student count + 取得學生姓名
    const { data: updatedRels } = await supabase
      .from('parent_student_relations')
      .select('students(id, name)')
      .eq('parent_id', id);
    const updatedStudents = (updatedRels ?? []).flatMap(
      (r: unknown) => {
        const students = (r as { students: Array<{ id: string; name: string }> }).students ?? [];
        return students;
      },
    );

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
      {
        data: toParentResponse(
          updatedRow as Record<string, unknown>,
          updatedStudents.length,
          undefined,
          updatedStudents.map((s) => s.name),
        ),
      },
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
      400: { description: '重設失敗', content: { 'application/json': { schema: ErrorSchema } } },
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
      await (auth.api as any).setUserPassword({
        body: { userId, newPassword },
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

// ============================================================
// POST /api/parents/batch-import
// ============================================================

const BatchImportRowSchema = z
  .object({
    parentName: z.string().min(1).max(100),
    parentPhone: z.string().max(20).optional(),
    parentEmail: z.string().email().optional(),
    parentNotes: z.string().max(2000).optional(),
    studentName: z.string().min(1).max(50),
    studentGrade: z.enum(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3']),
    studentSchool: z.string().min(1).max(100),
    studentBirthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    studentGender: z.enum(['male', 'female', 'prefer_not_to_say']).optional(),
  })
  .openapi('BatchImportRow');

const BatchImportBodySchema = z
  .object({
    rows: z.array(BatchImportRowSchema).min(1).max(500),
  })
  .openapi('BatchImportBody');

const BatchImportResultItemSchema = z
  .object({
    rowIndex: z.number(),
    status: z.enum(['success', 'failed']),
    parentId: z.string().optional(),
    studentId: z.string().optional(),
    error: z.string().optional(),
  })
  .openapi('BatchImportResultItem');

const BatchImportResponseSchema = z
  .object({
    parentsCreated: z.number(),
    studentsCreated: z.number(),
    results: z.array(BatchImportResultItemSchema),
  })
  .openapi('BatchImportResponse');

app.openapi(
  createRoute({
    method: 'post',
    path: '/batch-import',
    tags: ['Parents'],
    summary: '批次匯入家長與學生（Excel 批次建立）',
    request: {
      body: { content: { 'application/json': { schema: BatchImportBodySchema } } },
    },
    responses: {
      200: {
        description: '批次匯入結果（部分失敗仍回傳 200）',
        content: { 'application/json': { schema: BatchImportResponseSchema } },
      },
      400: { description: '請求格式錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');
    const { rows } = body;

    // 結果陣列
    const results: Array<{
      rowIndex: number;
      status: 'success' | 'failed';
      parentId?: string;
      studentId?: string;
      error?: string;
    }> = [];

    let parentsCreated = 0;
    let studentsCreated = 0;

    // ────────────────────────────────────────────────────────
    // Step 1：按 phone / email 分組，決定哪些 rows 共用同一家長
    // ────────────────────────────────────────────────────────
    type GroupKey = string; // normalize(phone) or normalize(email)
    // 對應 groupKey → rowIndexes
    const groupKeyToRowIndexes = new Map<GroupKey, number[]>();
    // rowIndex → groupKey（可能有多個 key 對到同一組，以第一個為主）
    const rowIndexToGroupKey = new Map<number, GroupKey>();

    // 先蒐集每個 row 的 normalize key（phone 優先，其次 email）
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const normalizedPhone = row.parentPhone ? row.parentPhone.trim().toLowerCase() : null;
      const normalizedEmail = row.parentEmail ? row.parentEmail.trim().toLowerCase() : null;
      const key: GroupKey | null = normalizedPhone ?? normalizedEmail ?? null;

      if (key) {
        const existing = groupKeyToRowIndexes.get(key);
        if (existing) {
          existing.push(i);
        } else {
          groupKeyToRowIndexes.set(key, [i]);
        }
        rowIndexToGroupKey.set(i, key);
      } else {
        // 沒有 phone 也沒有 email：無法建立家長帳號，直接失敗
        results.push({
          rowIndex: i,
          status: 'failed',
          error: 'parentPhone 或 parentEmail 至少填一個',
        });
      }
    }

    // ────────────────────────────────────────────────────────
    // Step 2：逐 group key 解析對應的「代表 row」（取第一個）
    //         並查找 / 建立家長帳號
    // ────────────────────────────────────────────────────────
    const groupKeyToParentId = new Map<GroupKey, string>();

    for (const [groupKey, rowIndexes] of groupKeyToRowIndexes) {
      const representativeRowIdx = rowIndexes[0];
      const representativeRow = rows[representativeRowIdx];

      let parentId: string | null = null;

      try {
        // 2a. 查 ba_user
        const normalizedPhone = representativeRow.parentPhone?.trim().toLowerCase() ?? null;
        const normalizedEmail = representativeRow.parentEmail?.trim().toLowerCase() ?? null;

        let baUserId: string | null = null;

        if (normalizedPhone || normalizedEmail) {
          const orParts: string[] = [];
          if (normalizedEmail) orParts.push(`email.eq.${normalizedEmail}`);
          if (normalizedPhone) orParts.push(`phone.eq.${normalizedPhone}`);

          const { data: baMatches } = await supabase
            .from('ba_user')
            .select('id')
            .or(orParts.join(','))
            .limit(1);

          if (baMatches && baMatches.length > 0) {
            baUserId = (baMatches[0] as { id: string }).id;
          }
        }

        // 2b. 若找到 baUserId，查 parents 表
        if (baUserId) {
          const { data: parentMatch } = await supabase
            .from('parents')
            .select('id')
            .eq('user_id', baUserId)
            .eq('org_id', orgId)
            .limit(1)
            .maybeSingle();

          if (parentMatch) {
            parentId = (parentMatch as { id: string }).id;
          }
        }

        // 2c. 若無既有家長 → 建立新帳號
        if (!parentId) {
          const auth = createAuth(c.env);
          const password = generateRandomPassword();

          let createdUserId: string | null = null;
          try {
            const newUser = await (auth.api as any).createUser({
              body: {
                name: representativeRow.parentName,
                email: representativeRow.parentEmail ?? undefined,
                phone: representativeRow.parentPhone ?? undefined,
                username:
                  !representativeRow.parentEmail && representativeRow.parentPhone
                    ? representativeRow.parentPhone
                    : undefined,
                password,
              },
              asResponse: false,
            });
            createdUserId = newUser.user.id;
          } catch (authErr) {
            const msg = authErr instanceof Error ? authErr.message : String(authErr);
            // Better Auth 可能因為 duplicate 拋錯，嘗試再查一次
            if (isDuplicateEmailError(msg) || isDuplicateUsernameError(msg)) {
              const orParts: string[] = [];
              if (normalizedEmail) orParts.push(`email.eq.${normalizedEmail}`);
              if (normalizedPhone) orParts.push(`phone.eq.${normalizedPhone}`);

              if (orParts.length > 0) {
                const { data: retryMatches } = await supabase
                  .from('ba_user')
                  .select('id')
                  .or(orParts.join(','))
                  .limit(1);

                if (retryMatches && retryMatches.length > 0) {
                  const existingBaUserId = (retryMatches[0] as { id: string }).id;
                  const { data: retryParent } = await supabase
                    .from('parents')
                    .select('id')
                    .eq('user_id', existingBaUserId)
                    .eq('org_id', orgId)
                    .limit(1)
                    .maybeSingle();

                  if (retryParent) {
                    parentId = (retryParent as { id: string }).id;
                    groupKeyToParentId.set(groupKey, parentId);
                    continue;
                  }
                }
              }
            }
            throw authErr;
          }

          // 更新 orgId
          await supabase.from('ba_user').update({ orgId }).eq('id', createdUserId);

          // INSERT parents
          const { data: newParentRow, error: insertParentError } = await supabase
            .from('parents')
            .insert({
              user_id: createdUserId,
              org_id: orgId,
              name: representativeRow.parentName,
              notes: representativeRow.parentNotes ?? null,
              status: 'active',
            })
            .select('id')
            .single();

          if (insertParentError || !newParentRow) {
            // 嘗試 rollback BA user
            try {
              await auth.api.removeUser({ body: { userId: createdUserId! }, asResponse: false });
            } catch {
              // ignore
            }
            throw new Error(insertParentError?.message ?? '建立家長資料失敗');
          }

          parentId = (newParentRow as { id: string }).id;
          parentsCreated++;
        }

        groupKeyToParentId.set(groupKey, parentId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // 將這個 group 內的所有 rows 標記為失敗
        for (const rowIdx of rowIndexes) {
          // 若該 rowIdx 還未被處理過（沒有 email/phone 缺少的錯誤）
          if (!results.find((r) => r.rowIndex === rowIdx)) {
            results.push({ rowIndex: rowIdx, status: 'failed', error: errMsg });
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────
    // Step 3：逐 row 建立學生 + parent_student_relations
    // ────────────────────────────────────────────────────────
    for (let i = 0; i < rows.length; i++) {
      // 已處理過（失敗的）rows 跳過
      if (results.find((r) => r.rowIndex === i)) continue;

      const row = rows[i];
      const groupKey = rowIndexToGroupKey.get(i);
      const parentId = groupKey ? groupKeyToParentId.get(groupKey) : undefined;

      if (!parentId) {
        results.push({ rowIndex: i, status: 'failed', error: '無法取得家長 ID' });
        continue;
      }

      try {
        // INSERT students
        const { data: newStudentRow, error: insertStudentError } = await supabase
          .from('students')
          .insert({
            org_id: orgId,
            name: row.studentName,
            grade: row.studentGrade,
            school: row.studentSchool,
            birthday: row.studentBirthday ?? null,
            gender: row.studentGender ?? null,
            status: 'active',
          })
          .select('id')
          .single();

        if (insertStudentError || !newStudentRow) {
          throw new Error(insertStudentError?.message ?? '建立學生失敗');
        }

        const studentId = (newStudentRow as { id: string }).id;
        studentsCreated++;

        // INSERT parent_student_relations
        const { error: relError } = await supabase.from('parent_student_relations').insert({
          parent_id: parentId,
          student_id: studentId,
          is_primary: true,
          relation: null,
        });

        if (relError) {
          // 嘗試刪除剛建立的學生（best effort）
          await supabase.from('students').delete().eq('id', studentId);
          studentsCreated--;
          throw new Error(relError.message);
        }

        results.push({ rowIndex: i, status: 'success', parentId, studentId });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({ rowIndex: i, status: 'failed', parentId, error: errMsg });
      }
    }

    // 依 rowIndex 排序
    results.sort((a, b) => a.rowIndex - b.rowIndex);

    return c.json({ parentsCreated, studentsCreated, results }, 200);
  },
);

export default app;
