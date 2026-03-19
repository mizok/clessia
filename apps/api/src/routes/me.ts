import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const GradeLevelSchema = z
  .enum(['K', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'])
  .openapi('MeGradeLevel');

const MeResponseSchema = z
  .object({
    userId: z.string(),
    orgId: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    birthday: z.string().nullable(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    isRootUser: z.boolean(),
  })
  .openapi('MeResponse');

const PatchMeSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .openapi('PatchMeRequest');

const ActivateParentSchema = z
  .object({
    studentName: z.string().min(1),
    grade: GradeLevelSchema,
  })
  .openapi('ActivateParentRequest');

const ErrorSchema = z.object({ error: z.string(), code: z.string() });

const app = new OpenAPIHono<AppEnv>();

// GET /api/me
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '取得目前登入用戶的 profile 和 roles',
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: MeResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const orgId = c.get('orgId');

    const [profileResult, rolesResult, staffResult, baUserResult] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', userId).single(),
      supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
      supabase.from('staff').select('birthday').eq('user_id', userId).maybeSingle(),
      supabase.from('ba_user').select('email, phone, username').eq('id', userId).single(),
    ]);

    return c.json({
      userId,
      orgId,
      displayName: (profileResult.data?.display_name ?? '') as string,
      email: (baUserResult.data?.email as string | null) ?? null,
      phone: (baUserResult.data?.phone as string | null) ?? null,
      birthday: (staffResult.data?.birthday as string | null) ?? null,
      roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
      permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
        Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
      ),
      isRootUser: (baUserResult.data?.username as string | null) === 'root',
    }, 200);
  },
);

// PATCH /api/me
app.openapi(
  createRoute({
    method: 'patch',
    path: '/',
    tags: ['Me'],
    summary: '更新個人資料',
    request: {
      body: { content: { 'application/json': { schema: PatchMeSchema } } },
    },
    responses: {
      200: {
        description: '更新成功',
        content: { 'application/json': { schema: MeResponseSchema } },
      },
      409: {
        description: 'Email 已被使用',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '伺服器錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (body.displayName !== undefined) {
      await supabase
        .from('profiles')
        .update({ display_name: body.displayName })
        .eq('id', userId);
    }

    if (body.email !== undefined) {
      const { error: emailError } = await supabase
        .from('ba_user')
        .update({ email: body.email })
        .eq('id', userId);
      if (emailError) {
        if (emailError.code === '23505') {
          return c.json({ error: '此 Email 已被使用', code: 'EMAIL_ALREADY_IN_USE' }, 409);
        }
        return c.json({ error: emailError.message, code: 'UPDATE_EMAIL_FAILED' }, 500);
      }
    }

    if (body.phone !== undefined) {
      const { data: baUser } = await supabase.from('ba_user').select('email').eq('id', userId).single();

      const updatePayload: Record<string, string | null> = { phone: body.phone };
      if ((baUser as Record<string, unknown> | null)?.['email'] == null) {
        updatePayload['username'] = body.phone;
      }
      await supabase.from('ba_user').update(updatePayload).eq('id', userId);
    }

    if (body.birthday !== undefined) {
      await supabase.from('staff').update({ birthday: body.birthday }).eq('user_id', userId);
    }

    const [profileResult, rolesResult, staffResult, baUserResult] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', userId).single(),
      supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
      supabase.from('staff').select('birthday').eq('user_id', userId).maybeSingle(),
      supabase.from('ba_user').select('email, phone, username').eq('id', userId).single(),
    ]);

    return c.json({
      userId,
      orgId: c.get('orgId'),
      displayName: (profileResult.data?.display_name ?? '') as string,
      email: (baUserResult.data?.email as string | null) ?? null,
      phone: (baUserResult.data?.phone as string | null) ?? null,
      birthday: (staffResult.data?.birthday as string | null) ?? null,
      roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
      permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
        Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
      ),
      isRootUser: (baUserResult.data?.username as string | null) === 'root',
    }, 200);
  },
);

// POST /api/me/activate-parent
app.openapi(
  createRoute({
    method: 'post',
    path: '/activate-parent',
    tags: ['Me'],
    summary: '啟用家長身份並建立子女學生資料',
    request: {
      body: { content: { 'application/json': { schema: ActivateParentSchema } } },
    },
    responses: {
      200: {
        description: '啟用成功',
        content: {
          'application/json': {
            schema: z.object({ studentId: z.string(), roles: z.array(z.string()) }),
          },
        },
      },
      500: {
        description: '伺服器錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    // Step 1：取得或建立 parents 記錄
    const { data: existingParent } = await supabase
      .from('parents')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();

    let parentId: string;

    if (existingParent) {
      parentId = (existingParent as Record<string, unknown>)['id'] as string;
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single();

      const { data: newParent, error: parentError } = await supabase
        .from('parents')
        .insert({
          user_id: userId,
          org_id: orgId,
          name: (profile as Record<string, unknown> | null)?.['display_name'] ?? '家長',
          status: 'active',
        })
        .select('id')
        .single();

      if (parentError || !newParent) {
        return c.json({ error: '建立家長資料失敗', code: 'CREATE_PARENT_FAILED' }, 500);
      }
      parentId = (newParent as Record<string, unknown>)['id'] as string;
    }

    // Step 2：建立學生記錄
    const { data: newStudent, error: studentError } = await supabase
      .from('students')
      .insert({
        org_id: orgId,
        name: body.studentName,
        grade: body.grade,
        school: '',
        is_active: true,
      })
      .select('id')
      .single();

    if (studentError || !newStudent) {
      return c.json({ error: '建立學生資料失敗', code: 'CREATE_STUDENT_FAILED' }, 500);
    }

    const studentId = (newStudent as Record<string, unknown>)['id'] as string;

    // Step 3：建立 parent_student_relations
    const { error: relError } = await supabase.from('parent_student_relations').insert({
      parent_id: parentId,
      student_id: studentId,
      is_primary: true,
      relation: null,
    });

    if (relError) {
      await supabase.from('students').delete().eq('id', studentId);
      return c.json({ error: '建立關聯失敗', code: 'CREATE_RELATION_FAILED' }, 500);
    }

    // Step 4：新增 parent role
    const { error: roleError } = await supabase.from('user_roles').upsert(
      { user_id: userId, role: 'parent', permissions: [] },
      { onConflict: 'user_id,role', ignoreDuplicates: true },
    );

    if (roleError) {
      await supabase
        .from('parent_student_relations')
        .delete()
        .eq('parent_id', parentId)
        .eq('student_id', studentId);
      await supabase.from('students').delete().eq('id', studentId);
      return c.json({ error: '賦予角色失敗', code: 'GRANT_ROLE_FAILED' }, 500);
    }

    const { data: rolesResult } = await supabase.from('user_roles').select('role').eq('user_id', userId);

    return c.json({
      studentId,
      roles: (rolesResult ?? []).map((r: { role: string }) => r.role),
    }, 200);
  },
);

export default app;
