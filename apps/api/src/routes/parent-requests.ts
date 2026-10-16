import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { getCampusScope, type CampusScope } from '../lib/campus-scope';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';

/**
 * 管理端：家長登入後在 app 裡送的報名（`enrollment_requests`）／試聽（`trial_requests`）申請（#1707）。
 * 寫入在家長端 `routes/parent/{enrollment,trial}-requests.ts`；這支只給管理端看、改狀態。
 * 前端跟 `/api/public-applications` 合在同一頁（`/admin/applications`），各自打各自的 API。
 *
 * - 授權照 `/api/public-applications`：掛 `manage_students`、**讀也擋**（學生、家長聯絡方式）。
 * - **分校範圍（c1）**：兩張表都沒有分校欄。報名看班的 `campus_id`、試聽看課程的 `campus_id` ——
 *   不能看學生的分校：學生的分校來自 enrollment，送申請的時候還沒有。PATCH 用同一判準，範圍外跟不存在一樣 404。
 *   班或課程被刪會 CASCADE 刪掉申請，所以沒有「目標不見了」的孤兒（public_applications 才有）。
 * - **兩套狀態不合併**（範圍說明 §2）：報名是「審核 → 待繳費 → 完成」，試聽是「排定 → 完成」。
 *   列表用 `group` 把兩套對到同一組分頁（待處理／進行中／已完成／不受理／已取消）。
 * - **報名在這裡只能拒絕**：核准＝開繳費單＋建 enrollment，是金額路徑，另開 #1726。
 *   已經 `awaiting_payment`（帳單開了）的不能拒絕，409。
 * - 試聽四個狀態任意切換（誤標要改得回來，同 public-applications）。
 */

const TRIAL_STATUSES = ['pending', 'scheduled', 'completed', 'cancelled'] as const;

/** 頁面的分組 → 兩張表各自的狀態（範圍說明 §2 的表） */
const GROUPS = {
  pending: { enrollment: ['pending', 'waitlist'], trial: ['pending'] },
  active: { enrollment: ['awaiting_payment'], trial: ['scheduled'] },
  done: { enrollment: ['completed'], trial: ['completed'] },
  rejected: { enrollment: ['rejected'], trial: [] },
  cancelled: { enrollment: ['cancelled', 'expired'], trial: ['cancelled'] },
} as const satisfies Record<string, { enrollment: readonly string[]; trial: readonly string[] }>;

/** 拒絕只收這兩個：`awaiting_payment` 已經開了帳單，拒絕會留下一張沒人處理的帳單 */
const REJECTABLE = ['pending', 'waitlist'];

const SELECT = {
  enrollment: `id, status, preferred_start_date, note, reject_reason, requested_by, created_at,
    student_id, students(name), classes(name, campus_id, campuses(name))`,
  trial: `id, status, preferred_times, note, requested_by, created_at,
    student_id, students(name), courses(name, campus_id, campuses(name))`,
} as const;
const TABLE = { enrollment: 'enrollment_requests', trial: 'trial_requests' } as const;
type Kind = keyof typeof TABLE;

const RequestSchema = z
  .object({
    id: DbUuidSchema,
    kind: z.enum(['enrollment', 'trial']),
    /** 報名與試聽各自的狀態值（不合併） */
    status: z.string(),
    createdAt: z.string(),
    student: z.object({ id: z.string(), name: z.string() }),
    /** 送出申請的家長（本 org 的家長資料＋帳號電話）；查不到就 null */
    parent: z.object({ name: z.string().nullable(), phone: z.string().nullable() }),
    target: z.object({ name: z.string(), campusName: z.string().nullable() }),
    preferredStartDate: z.string().nullable(),
    preferredTimes: z.string().nullable(),
    note: z.string().nullable(),
    /** 報名被拒絕時寫給家長看的原因 */
    rejectReason: z.string().nullable(),
  })
  .openapi('ParentRequest');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentRequestAdminError');

type Row = Record<string, any>;
const one = (v: unknown): Row | null => (Array.isArray(v) ? v[0] : v) ?? null;
const targetOf = (kind: Kind, row: Row) =>
  one(kind === 'enrollment' ? row['classes'] : row['courses']);

function visible(kind: Kind, row: Row, scope: CampusScope): boolean {
  if (scope === null) return true;
  const campusId = targetOf(kind, row)?.['campus_id'] as string | undefined;
  return !!campusId && scope.includes(campusId);
}

interface Contact {
  name: string | null;
  phone: string | null;
}

function toResponse(kind: Kind, row: Row, contacts: Map<string, Contact>) {
  const target = targetOf(kind, row);
  return {
    id: row['id'] as string,
    kind,
    status: row['status'] as string,
    createdAt: row['created_at'] as string,
    student: {
      id: row['student_id'] as string,
      name: (one(row['students'])?.['name'] as string | undefined) ?? '',
    },
    parent: contacts.get(row['requested_by'] as string) ?? { name: null, phone: null },
    target: {
      name: (target?.['name'] as string | undefined) ?? '',
      campusName: (one(target?.['campuses'])?.['name'] as string | undefined) ?? null,
    },
    preferredStartDate: (row['preferred_start_date'] as string | null) ?? null,
    preferredTimes: (row['preferred_times'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    rejectReason: (row['reject_reason'] as string | null) ?? null,
  };
}

/**
 * 送申請的家長：名字取本 org 的 `parents`（同一個帳號可能在別的 org 也是家長），電話取 `ba_user`
 * （`parents` 沒有電話欄；`ba_*` 可讀不可寫，c2）。同 routes/parents.ts 的做法。
 */
async function contactsOf(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  userIds: string[],
): Promise<Map<string, Contact>> {
  const map = new Map<string, Contact>();
  if (userIds.length === 0) return map;
  const [parents, users] = await Promise.all([
    supabase.from('parents').select('user_id, name').eq('org_id', orgId).in('user_id', userIds),
    supabase.from('ba_user').select('id, phone').in('id', userIds),
  ]);
  const phone = new Map(
    ((users.data ?? []) as Row[]).map((u) => [u['id'] as string, (u['phone'] as string) ?? null]),
  );
  const name = new Map(
    ((parents.data ?? []) as Row[]).map((p) => [p['user_id'] as string, p['name'] as string]),
  );
  for (const userId of userIds) {
    map.set(userId, { name: name.get(userId) ?? null, phone: phone.get(userId) ?? null });
  }
  return map;
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/parent-requests
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['ParentRequests'],
    summary: '家長在 app 送的報名／試聽申請（預設待處理）',
    request: {
      query: z.object({
        group: z.enum(['pending', 'active', 'done', 'rejected', 'cancelled']).optional(),
        kind: z.enum(['enrollment', 'trial']).optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: z.array(RequestSchema) }) } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { group = 'pending', kind } = c.req.valid('query');
    const kinds = (kind ? [kind] : ['enrollment', 'trial']) as Kind[];
    const scope = getCampusScope(c);

    // ponytail: 分校範圍在記憶體濾、不分頁 —— 同 public-applications，一間補習班的待處理申請是個位數到幾十筆
    const results = await Promise.all(
      kinds.map(async (k) => {
        const statuses = GROUPS[group][k] as readonly string[];
        if (statuses.length === 0) return { k, rows: [] as Row[], error: null };
        // 直接 `.eq('org_id')` 不經 `inOrg`：embed 的 builder 交給 inOrg 會撞 TS2589（同 public-applications）
        const { data, error } = await supabase
          .from(TABLE[k])
          .select(SELECT[k])
          .eq('org_id', orgId)
          .in('status', [...statuses]);
        return { k, rows: ((data ?? []) as Row[]).filter((r) => visible(k, r, scope)), error };
      }),
    );
    if (results.some((r) => r.error)) {
      return c.json({ error: '讀取家長申請失敗', code: 'FETCH_FAILED' }, 500);
    }

    const contacts = await contactsOf(supabase, orgId, [
      ...new Set(results.flatMap((r) => r.rows.map((row) => row['requested_by'] as string))),
    ]);
    const data = results
      .flatMap((r) => r.rows.map((row) => toResponse(r.k, row, contacts)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ data }, 200);
  },
);

// PATCH /api/parent-requests/:kind/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{kind}/{id}',
    tags: ['ParentRequests'],
    summary: '改家長申請的狀態（報名只能拒絕＋原因；試聽排定／完成／取消）',
    request: {
      params: z.object({ kind: z.enum(['enrollment', 'trial']), id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              status: z.string(),
              /** 報名拒絕時必填，家長看得到 */
              rejectReason: z.string().trim().max(500).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: RequestSchema }) } },
      },
      400: {
        description: '狀態不合法或缺拒絕原因',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '不存在或不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '已核准待繳費，不能拒絕',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { kind, id } = c.req.valid('param');
    const body = c.req.valid('json');
    const invalid = (error: string) => c.json({ error, code: 'INVALID_STATUS' }, 400);

    // 先驗內容、再查列：不合法的請求不必碰 DB
    const patch: Record<string, unknown> = { status: body.status };
    if (kind === 'enrollment') {
      if (body.status !== 'rejected') return invalid('報名申請在這裡只能拒絕');
      if (!body.rejectReason) return invalid('拒絕要寫原因，家長看得到');
      patch['reject_reason'] = body.rejectReason;
    } else if (!(TRIAL_STATUSES as readonly string[]).includes(body.status)) {
      return invalid('試聽狀態不合法');
    }

    const { data: before } = await supabase
      .from(TABLE[kind])
      .select(SELECT[kind])
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!before || !visible(kind, before as Row, getCampusScope(c))) {
      return c.json({ error: '找不到這筆申請', code: 'NOT_FOUND' }, 404);
    }
    const prev = before as Row;
    if (kind === 'enrollment' && !REJECTABLE.includes(prev['status'] as string)) {
      return c.json({ error: '這筆申請已經不是待審核，不能拒絕', code: 'NOT_REJECTABLE' }, 409);
    }

    // 報名的拒絕帶上「狀態還是可拒絕」當條件：讀完到寫入之間別人可能已經核准了（#1726 上線後就會發生），
    // 沒寫到任何一列就是被搶先了 → 409，不蓋掉已經開了帳單的那一筆（審核席 #1728 建議）
    // 直接 `.eq('org_id')` 不經 `inOrg`：條件式的 builder 交給 inOrg 會撞 TS2589（同上面的讀取）
    const update = supabase.from(TABLE[kind]).update(patch).eq('org_id', orgId).eq('id', id);
    const { data: written, error } = await (
      kind === 'enrollment' ? update.in('status', REJECTABLE) : update
    ).select('id');
    if (error) return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 500);
    if (!written || (written as unknown[]).length === 0) {
      return c.json({ error: '這筆申請已經不是待審核，不能拒絕', code: 'NOT_REJECTABLE' }, 409);
    }

    const after = { ...prev, ...patch };
    const contacts = await contactsOf(supabase, orgId, [prev['requested_by'] as string]);
    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: kind === 'enrollment' ? 'enrollment_request' : 'trial_request',
        resourceId: id,
        resourceName: `${one(prev['students'])?.['name'] ?? ''}（${targetOf(kind, prev)?.['name'] ?? ''}）`,
        action: 'update',
        details: {
          before: { status: prev['status'], rejectReason: prev['reject_reason'] ?? null },
          after: { status: after['status'], rejectReason: after['reject_reason'] ?? null },
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: toResponse(kind, after, contacts) }, 200);
  },
);

export default app;
