import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';

/**
 * 通知中心的「通知」來源（#1688，#1626 改版；介面照 #1683 的提案）。
 *
 * 通知是排程寫進 `notifications` 的紀錄（#1661）；推播只是其中一種送達管道 —— 沒開推播的家長
 * 這裡一樣看得到。形狀刻意對齊 `/api/announcements/inbox`，前端用同一套方式合併兩個來源。
 *
 * **一切都是自己的**：`user_id`／`org_id` 一律取自 session，讀寫都帶（c1）。
 * **身分**：通知帶 `role`，照 active role 過濾 —— 同一個人切到老師身分時不會看到家長的繳費提醒。
 * 三個角色都有通知（使用者更正 Q7，#1693：老師、管理員不推播但有通知）；某個身分還沒有任何通知時
 * 就是 200 空清單，不回 403，前端不用分支。
 */

/** active role 有就用它；沒帶時跟公告一樣先看老師、再看家長，最後管理員（只有管理員身分的人） */
export function notificationRoleFor(
  roles: readonly string[],
  activeRole: string | null | undefined,
): string | null {
  return (
    activeRole ?? (['teacher', 'parent', 'admin'] as const).find((r) => roles.includes(r)) ?? null
  );
}

const ItemSchema = z.object({
  id: z.string(),
  /** `invoice_due`／`invoice_overdue`，前端都顯示「繳費提醒」 */
  kind: z.string(),
  title: z.string(),
  /** 不含金額（排入當下寫好的，之後繳費金額就過時了；看金額請點 link） */
  body: z.string(),
  createdAt: z.string(),
  isRead: z.boolean(),
  link: z.string().nullable(),
});

const InboxSchema = z
  .object({
    data: z.array(ItemSchema),
    meta: z.object({ total: z.number().int().min(0), unread: z.number().int().min(0) }),
  })
  .openapi('NotificationInbox');

const ErrorSchema = z.object({ error: z.string(), code: z.string() });

interface Row {
  id: string;
  kind: string;
  payload: { title?: string; body?: string; url?: string } | null;
  created_at: string;
  read_at: string | null;
}

/**
 * 清單一次最多回幾則。通知保留 90 天（排程會清，#1661），家長一個月頂多十幾則；
 * 管理員的申請、老師的課務異動（#1693）可能多得多，所以不靠 90 天當上限。
 * 第一版不做分頁 —— 前端只顯示最新的這些，舊的到期就清掉。
 */
const INBOX_LIMIT = 100;

const app = new OpenAPIHono<AppEnv>();

// GET /api/notifications/inbox
app.openapi(
  createRoute({
    method: 'get',
    path: '/inbox',
    tags: ['Notifications'],
    summary: '自己這個身分的通知（新的在前，最多 100 則；total／unread 是全部的數）',
    responses: {
      200: {
        description: '通知與未讀數',
        content: { 'application/json': { schema: InboxSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const role = notificationRoleFor(c.get('roles') ?? [], c.get('activeRole'));
    if (!role) return c.json({ data: [], meta: { total: 0, unread: 0 } }, 200);
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    // 清單只回最新的 INBOX_LIMIT 則；total／unread 由 DB 數（不是數回傳的那幾列），
    // 角標（#1683）才不會在第 101 則之後停在 100。兩支各寫一次條件 —— 抽成泛型 helper 會撞 TS2589
    const [list, unread] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, kind, payload, created_at, read_at', { count: 'exact' })
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .eq('role', role)
        .order('created_at', { ascending: false })
        .limit(INBOX_LIMIT),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .eq('role', role)
        .is('read_at', null),
    ]);
    if (list.error || unread.error) {
      return c.json({ error: '讀取通知失敗', code: 'DB_ERROR' }, 500);
    }
    const rows = (list.data ?? []) as Row[];
    return c.json(
      {
        data: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.payload?.title ?? '',
          body: r.payload?.body ?? '',
          createdAt: r.created_at,
          isRead: r.read_at !== null,
          link: r.payload?.url ?? null,
        })),
        meta: { total: list.count ?? rows.length, unread: unread.count ?? 0 },
      },
      200,
    );
  },
);

// POST /api/notifications/read-all —— 這個身分全部標已讀，一句 UPDATE
// （註冊在 /{id}/read 前面：路徑不衝突，但讀的人不用想）
app.openapi(
  createRoute({
    method: 'post',
    path: '/read-all',
    tags: ['Notifications'],
    responses: {
      200: {
        description: '這次標了幾則',
        content: { 'application/json': { schema: z.object({ marked: z.number().int().min(0) }) } },
      },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const role = notificationRoleFor(c.get('roles') ?? [], c.get('activeRole'));
    if (!role) return c.json({ marked: 0 }, 200);
    const { data, error } = await c
      .get('supabase')
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', c.get('userId'))
      .eq('org_id', c.get('orgId'))
      .eq('role', role)
      .is('read_at', null)
      .select('id');
    if (error) return c.json({ error: '標記已讀失敗', code: 'DB_ERROR' }, 500);
    return c.json({ marked: (data ?? []).length }, 200);
  },
);

// POST /api/notifications/{id}/read —— 只能標自己的；已讀過的保留第一次讀的時間
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Notifications'],
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      204: { description: '已讀（含本來就讀過）' },
      404: {
        description: '不存在或不是自己的',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .is('read_at', null)
      .select('id');
    if (error) return c.json({ error: '標記已讀失敗', code: 'DB_ERROR' }, 500);
    if ((data ?? []).length > 0) return c.body(null, 204);

    // 沒標到：本來就讀過（204）還是不是自己的／不存在（404）—— 同樣只看自己的
    const { data: own, error: ownError } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (ownError) return c.json({ error: '標記已讀失敗', code: 'DB_ERROR' }, 500);
    if (!own) return c.json({ error: '通知不存在', code: 'NOT_FOUND' }, 404);
    return c.body(null, 204);
  },
);

export default app;
