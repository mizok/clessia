import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { isEnrolledOn } from '../lib/session-roster';
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
  /** 課務異動有「原本／改為」可以展開（#1100 #49，payload 帶 sessionIds 的才有） */
  hasChangeDetail: z.boolean(),
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
  payload: { title?: string; body?: string; url?: string; sessionIds?: string[] } | null;
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
          hasChangeDetail: (r.payload?.sessionIds?.length ?? 0) > 0,
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

// ============================================================
// GET /api/notifications/{id}/schedule-change —— 家長展開課務異動的「原本／改為」（#1100 #49）
//
// - 只讀自己的、家長身分、kind schedule_change 的那則；哪幾堂從 `payload.sessionIds` 來
// - **payload 不當授權依據**：再用 `childDb` 確認每一堂是自己孩子那天在籍的班，不是就不回那一堂
// - 即時算：「改為」是那堂現在的樣子（之後又改了就是最新的），「原本」取最新一筆異動記下的原值
// - 原因只給停課（#46）
// ============================================================

const SlotSchema = z.object({
  date: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  teacherName: z.string().nullable(),
});

const ChangeDetailSchema = z
  .object({
    data: z.array(
      z.object({
        sessionId: DbUuidSchema,
        className: z.string().nullable(),
        changeType: z.string(),
        was: SlotSchema,
        /** 停課（這堂現在是 cancelled）＝ null */
        now: SlotSchema.nullable(),
        /** 只有停課才有 */
        reason: z.string().nullable(),
      }),
    ),
  })
  .openapi('NotificationChangeDetail');

type Rec = Record<string, unknown>;
const one = (v: unknown): Rec | null => (Array.isArray(v) ? (v[0] as Rec) : (v as Rec | null));
const hhmm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : null);

app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/schedule-change',
    tags: ['Notifications'],
    summary: '課務異動通知的原本／改為（家長）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ChangeDetailSchema } } },
      404: {
        description: '不存在、不是自己的、或不是課務異動',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const notFound = () => c.json({ error: '找不到這則通知', code: 'NOT_FOUND' }, 404);
    const failed = () => c.json({ error: '讀取失敗', code: 'DB_ERROR' }, 500);
    if (notificationRoleFor(c.get('roles') ?? [], c.get('activeRole')) !== 'parent') {
      return notFound();
    }
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data: note, error: noteError } = await supabase
      .from('notifications')
      .select('payload')
      .eq('id', id)
      .eq('user_id', c.get('userId'))
      .eq('org_id', orgId)
      .eq('role', 'parent')
      .eq('kind', 'schedule_change')
      .maybeSingle();
    if (noteError) return failed();
    const sessionIds = ((note as Row | null)?.payload?.sessionIds ?? []).filter(
      (x) => DbUuidSchema.safeParse(x).success,
    );
    if (!note || sessionIds.length === 0) return notFound();

    // **先限範圍再撈**（計畫席讀 diff，A19 的精神）：逐個孩子從 childDb 的報名取出 class_id（ScopedIds），
    // 課堂只在這些班裡撈；不是自己孩子的班在查詢層就撈不到，不靠後面的 filter。
    // 孩子通常 1–3 位，一位一組查詢；在籍日期的判斷留在下面的 TS。
    const childDb = c.get('childDb');
    const children = c.get('studentScope') ?? [];
    const perChild = await Promise.all(
      children.map(async (childId) => {
        const plucked = await childDb
          .from('enrollments', 'student_id')
          .pluck('class_id, effective_from, effective_to, status', 'class_id', childId);
        if (plucked.error) return { error: plucked.error, ranges: [], sessions: [] };
        const ranges = plucked.rows.filter((r) => r['status'] !== 'void');
        if (plucked.ids.length === 0) return { error: null, ranges, sessions: [] };
        const { data, error } = await childDb
          .fromScopedIds('sessions', 'class_id', plucked.ids)
          .select(
            'id, class_id, session_date, start_time, end_time, status, classes(name), teacher:staff!teacher_id(display_name)',
          )
          .eq('org_id', orgId)
          .in('id', sessionIds);
        return { error, ranges, sessions: (data ?? []) as unknown as Rec[] };
      }),
    );
    if (perChild.some((r) => r.error)) return failed();
    const ranges = perChild.flatMap((r) => r.ranges) as unknown as Array<{
      class_id: string;
      effective_from: string;
      effective_to: string | null;
    }>;
    const scopedSessions = [
      ...new Map(perChild.flatMap((r) => r.sessions).map((x) => [x['id'] as string, x])).values(),
    ];
    if (scopedSessions.length === 0) return c.json({ data: [] }, 200);

    // 異動只查上面在範圍內撈到的那幾堂
    const changes = await supabase
      .from('schedule_changes')
      .select(
        'session_id, change_type, reason, original_session_date, original_start_time, original_end_time, original_teacher_name, created_at',
      )
      .eq('org_id', orgId)
      .in(
        'session_id',
        scopedSessions.map((x) => x['id'] as string),
      )
      .order('created_at', { ascending: false });
    if (changes.error) return failed();

    const latest = new Map<string, Rec>();
    for (const ch of (changes.data ?? []) as unknown as Rec[]) {
      if (!latest.has(ch['session_id'] as string)) latest.set(ch['session_id'] as string, ch);
    }

    const data = scopedSessions
      .filter((s) => {
        const ch = latest.get(s['id'] as string);
        // 原本那天或現在那天在籍其一就算（調課可能把課調出他的在籍區間）
        const days = [
          s['session_date'] as string,
          (ch?.['original_session_date'] as string) ?? null,
        ];
        return ranges.some(
          (r) =>
            r.class_id === s['class_id'] &&
            days.some(
              (d) =>
                d !== null &&
                isEnrolledOn({ effectiveFrom: r.effective_from, effectiveTo: r.effective_to }, d),
            ),
        );
      })
      .sort((a, b) => String(a['session_date']).localeCompare(String(b['session_date'])))
      .map((s) => {
        const ch = latest.get(s['id'] as string) ?? {};
        const teacher = (one(s['teacher'])?.['display_name'] as string | undefined) ?? null;
        const now = {
          date: s['session_date'] as string,
          startTime: hhmm(s['start_time']),
          endTime: hhmm(s['end_time']),
          teacherName: teacher,
        };
        const cancelled = s['status'] === 'cancelled';
        return {
          sessionId: s['id'] as string,
          className: (one(s['classes'])?.['name'] as string | undefined) ?? null,
          changeType: (ch['change_type'] as string | undefined) ?? 'unknown',
          was: {
            date: (ch['original_session_date'] as string | null) ?? now.date,
            startTime: hhmm(ch['original_start_time']) ?? now.startTime,
            endTime: hhmm(ch['original_end_time']) ?? now.endTime,
            teacherName: (ch['original_teacher_name'] as string | null) ?? teacher,
          },
          now: cancelled ? null : now,
          reason:
            ch['change_type'] === 'cancellation' ? ((ch['reason'] as string | null) ?? null) : null,
        };
      });
    return c.json({ data }, 200);
  },
);

export default app;
