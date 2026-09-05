import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { resolveDisplayName, updateDisplayName } from '../lib/display-name';
import { getAuth } from '../lib/get-auth';
import childrenRoute from './parent/children';
import attendanceRoute from './parent/attendance';
import gradesRoute from './parent/grades';
import billingRoute from './parent/billing';

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

    const [profileResult, rolesResult, staffResult, parentResult, baUserResult] = await Promise.all(
      [
        supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
        supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
        supabase.from('staff').select('display_name, birthday').eq('user_id', userId).maybeSingle(),
        supabase.from('parents').select('name').eq('user_id', userId).maybeSingle(),
        supabase.from('ba_user').select('name, email, phone').eq('id', userId).single(),
      ],
    );

    return c.json(
      {
        userId,
        orgId,
        // profiles 不是可靠的來源 —— 見 lib/display-name.ts
        displayName: resolveDisplayName({
          profile: profileResult.data,
          staff: staffResult.data,
          parent: parentResult.data,
          baUser: baUserResult.data,
        }),
        email: (baUserResult.data?.email as string | null) ?? null,
        phone: (baUserResult.data?.phone as string | null) ?? null,
        birthday: (staffResult.data?.birthday as string | null) ?? null,
        roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
        permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
          Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
        ),
      },
      200,
    );
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
      await updateDisplayName(supabase, userId, body.displayName);
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
      const { data: baUser } = await supabase
        .from('ba_user')
        .select('email')
        .eq('id', userId)
        .single();

      // **phone 走 Better Auth 的 API（c2 的合規路徑）。**
      // `phone` 是 `auth.ts` 宣告的 additionalField 且 `input: true`，所以
      // `updateUser` 收得下它。這支是「本人改自己」，session headers 拿得到 ——
      // 而 `updateUser` 掛 `sessionMiddleware`，沒有 headers 就走不通
      //（管理員改別人的那兩處因此無法比照，見 constitution-enforcement.md）。
      await getAuth(c).api.updateUser({
        body: { phone: body.phone },
        headers: c.req.raw.headers,
      });

      // **這不是登入帳號的殘留，不要刪 —— 而且它只能直寫。** 沒有 email 的家長
      //（只留電話那種）靠 `ba_user.username` 當唯一性鍵，家長匯入的重複偵測會拿它
      // 比對電話（`routes/parents.ts` 的 `buildPostgrestEq('username', phone)`）。
      //
      // **`username` 沒有 API 路徑**：username plugin 已被刻意移除（`auth.ts`，
      // 它提供的 `/sign-in/username` 也是密碼登入），所以它不是宣告過的
      // additionalField —— 傳給 `updateUser` 會被**靜默丟棄**（`parseInputData`
      // 迭代的是宣告過的 schema，未宣告的 key 連看都不看）。
      // 也就是說「一起塞進上面那個呼叫」不會報錯，只會不寫入。c2 永久豁免。
      // 見 kb/wiki/specs/admin/roles-and-auth.md
      if ((baUser as Record<string, unknown> | null)?.['email'] == null) {
        await supabase.from('ba_user').update({ username: body.phone }).eq('id', userId);
      }
    }

    if (body.birthday !== undefined) {
      await supabase.from('staff').update({ birthday: body.birthday }).eq('user_id', userId);
    }

    const [profileResult, rolesResult, staffResult, parentResult, baUserResult] = await Promise.all(
      [
        supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
        supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
        supabase.from('staff').select('display_name, birthday').eq('user_id', userId).maybeSingle(),
        supabase.from('parents').select('name').eq('user_id', userId).maybeSingle(),
        supabase.from('ba_user').select('name, email, phone').eq('id', userId).single(),
      ],
    );

    return c.json(
      {
        userId,
        orgId: c.get('orgId'),
        displayName: resolveDisplayName({
          profile: profileResult.data,
          staff: staffResult.data,
          parent: parentResult.data,
          baUser: baUserResult.data,
        }),
        email: (baUserResult.data?.email as string | null) ?? null,
        phone: (baUserResult.data?.phone as string | null) ?? null,
        birthday: (staffResult.data?.birthday as string | null) ?? null,
        roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
        permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
          Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
        ),
      },
      200,
    );
  },
);

// POST /api/me/activate-parent
app.openapi(
  createRoute({
    method: 'post',
    path: '/activate-parent',
    tags: ['Me'],
    summary: '啟用家長身份',
    responses: {
      200: {
        description: '啟用成功',
        content: {
          'application/json': {
            schema: z.object({ roles: z.array(z.string()) }),
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

    // Step 1：取得或建立 parents 記錄
    const { data: existingParent } = await supabase
      .from('parents')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existingParent) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single();

      const { error: parentError } = await supabase.from('parents').insert({
        user_id: userId,
        org_id: orgId,
        name: (profile as Record<string, unknown> | null)?.['display_name'] ?? '家長',
        status: 'active',
      });

      if (parentError) {
        return c.json({ error: '建立家長資料失敗', code: 'CREATE_PARENT_FAILED' }, 500);
      }
    }

    // Step 2：新增 parent role
    const { error: roleError } = await supabase
      .from('user_roles')
      .upsert(
        { user_id: userId, role: 'parent', permissions: [] },
        { onConflict: 'user_id,role', ignoreDuplicates: true },
      );

    if (roleError) {
      return c.json({ error: '賦予角色失敗', code: 'GRANT_ROLE_FAILED' }, 500);
    }

    const { data: rolesResult } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    return c.json(
      {
        roles: (rolesResult ?? []).map((r: { role: string }) => r.role),
      },
      200,
    );
  },
);

app.route('/children', childrenRoute);
app.route('/attendance', attendanceRoute);
app.route('/grades', gradesRoute);
app.route('/billing', billingRoute);

export default app;
