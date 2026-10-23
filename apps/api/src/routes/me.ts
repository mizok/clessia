import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { resolveDisplayName, updateDisplayName } from '../lib/display-name';
import { getAuth } from '../lib/get-auth';
import { loadMeExtrasViaSql, loadNickname, type MeExtras } from '../lib/identity-sql';
import childrenRoute from './parent/children';
import attendanceRoute from './parent/attendance';
import gradesRoute from './parent/grades';
import billingRoute from './parent/billing';
import classLogsRoute from './parent/class-logs';
import contactBookRoute from './parent/contact-book';
import enrollmentRequestsRoute from './parent/enrollment-requests';
import trialRequestsRoute from './parent/trial-requests';
import sessionsRoute from './parent/sessions';
import catalogRoute from './parent/catalog';
import renewalRoute from './parent/renewal';
import mealsRoute from './parent/meals';
import leavesRoute from './parent/leaves';
import mePushRoute from './me-push';
import { inOrg } from '../lib/org-scope';
import { NicknameSchema } from '../lib/validation';
import { invalidateIdentity } from '../lib/identity-cache';

const MeResponseSchema = z
  .object({
    userId: z.string(),
    orgId: z.string(),
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    birthday: z.string().nullable(),
    /** 對外暱稱（#1665 Q6′）。沒有 staff 身分的人（家長）一律 null */
    nickname: z.string().nullable(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    /** 被指派的分校（`staff_campuses`）。**只給前端挑預設分校**，範圍仍由後端 campusScope 判（c1） */
    assignedCampusIds: z.array(z.string()),
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
    /** 只寫得進有 staff 身分的人自己那一列；家長帶了也不會寫到任何地方 */
    nickname: NicknameSchema.optional(),
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

    // 角色、權限、staff／parents 列都是 auth middleware 已經查好的（#1595 P2a）——
    // 這裡原本各查一次，user_roles 那支跟 middleware 完全重複
    const { staff, parent, assignedCampusIds } = c.get('selfRows');
    // 先走 SQL（Hyperdrive，一次往返），失敗或形狀不對就走原本的兩支 REST（見 lib/identity-sql.ts）
    const auth = getAuth(c);
    const viaRest = async (): Promise<MeExtras> => {
      const [u, nickname] = await Promise.all([
        supabase.from('ba_user').select('name, email, phone').eq('id', userId).single(),
        staff ? loadNickname(supabase, userId, orgId) : null,
      ]);
      return {
        baUser: u.data as MeExtras['baUser'],
        nickname,
      };
    };
    const { baUser, nickname }: MeExtras =
      (auth.pool ? await loadMeExtrasViaSql(auth.pool, userId, orgId) : null) ?? (await viaRest());

    return c.json(
      {
        userId,
        orgId,
        // profiles 不是可靠的來源 —— 見 lib/display-name.ts
        displayName: resolveDisplayName({
          staff,
          parent,
          baUser,
        }),
        email: baUser?.email ?? null,
        phone: baUser?.phone ?? null,
        birthday: staff?.birthday ?? null,
        nickname: staff ? nickname : null,
        roles: c.get('roles'),
        permissions: c.get('permissions'),
        assignedCampusIds,
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
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (body.displayName !== undefined) {
      await updateDisplayName(supabase, orgId, userId, body.displayName);
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

    if (body.birthday !== undefined || body.nickname !== undefined) {
      await inOrg(
        supabase
          .from('staff')
          .update({
            ...(body.birthday === undefined ? {} : { birthday: body.birthday }),
            ...(body.nickname === undefined ? {} : { nickname: body.nickname }),
          })
          .eq('user_id', userId),
        orgId,
      );
    }

    const [rolesResult, staffResult, parentResult, baUserResult] = await Promise.all([
      supabase.from('user_roles').select('role, permissions').eq('user_id', userId),
      supabase.from('staff').select('display_name, birthday').eq('user_id', userId).maybeSingle(),
      supabase.from('parents').select('name').eq('user_id', userId).maybeSingle(),
      supabase.from('ba_user').select('name, email, phone').eq('id', userId).single(),
    ]);

    // 寫入成功才清（#1631）：前端接著重抓 /api/me，不清的話同一個 isolate 會回快取裡的舊名字／生日
    invalidateIdentity(userId);

    return c.json(
      {
        userId,
        orgId: c.get('orgId'),
        displayName: resolveDisplayName({
          staff: staffResult.data,
          parent: parentResult.data,
          baUser: baUserResult.data,
        }),
        email: (baUserResult.data?.email as string | null) ?? null,
        phone: (baUserResult.data?.phone as string | null) ?? null,
        birthday: (staffResult.data?.birthday as string | null) ?? null,
        nickname: staffResult.data ? await loadNickname(supabase, userId, orgId) : null,
        roles: (rolesResult.data ?? []).map((r: { role: string }) => r.role),
        permissions: (rolesResult.data ?? []).flatMap((r: { permissions: unknown[] }) =>
          Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
        ),
        // 改個人資料動不到分校指派，沿用 middleware 那份
        assignedCampusIds: c.get('selfRows').assignedCampusIds,
      },
      200,
    );
  },
);

// 推播訂閱與通知偏好（#1659）：/push-config、/push-subscriptions、/notification-preferences
app.route('/', mePushRoute);
app.route('/children', childrenRoute);
app.route('/attendance', attendanceRoute);
app.route('/grades', gradesRoute);
app.route('/renewal-preview', renewalRoute);
app.route('/meals', mealsRoute);
app.route('/billing', billingRoute);
app.route('/class-logs', classLogsRoute);
app.route('/contact-book', contactBookRoute);
app.route('/enrollment-requests', enrollmentRequestsRoute);
app.route('/trial-requests', trialRequestsRoute);
app.route('/sessions', sessionsRoute);
app.route('/catalog', catalogRoute);
app.route('/leaves', leavesRoute);

export default app;
