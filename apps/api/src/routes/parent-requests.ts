import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { getCampusScope, type CampusScope } from '../lib/campus-scope';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';
import { approveEnrollmentRequest } from '../lib/enrollment-approve';
import { notifyEnrollmentApproved } from '../lib/notify-events';
import { getAuth } from '../lib/get-auth';
import { fetchAllPages } from '../lib/fetch-all-pages';
import { hasPermission } from '../lib/permissions';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { checkEnrollmentPreconditions } from './enrollments/validation';

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
 * - **報名的拒絕**走 PATCH；已經 `awaiting_payment`（帳單開了）的不能拒絕，409。
 * - **報名的核准**走 `POST /enrollment/{id}/approve`（#1726，金額路徑）：建報名＋開帳單＋申請轉待付款，
 *   一個交易（`lib/enrollment-approve.ts`）。要 `manage_students` **且** `manage_finance`（使用者 10-21 裁 Q6）。
 * - 試聽四個狀態任意切換（誤標要改得回來，同 public-applications）。
 */

const TRIAL_STATUSES = ['pending', 'scheduled', 'completed', 'cancelled'] as const;

/** 頁面的分組 → 兩張表各自的狀態（範圍說明 §2 的表） */
const GROUPS = {
  pending: { enrollment: ['pending', 'waitlist'], trial: ['pending'], renewal: ['pending'] },
  active: { enrollment: ['awaiting_payment'], trial: ['scheduled'], renewal: [] },
  done: { enrollment: ['completed'], trial: ['completed'], renewal: ['resolved'] },
  rejected: { enrollment: ['rejected'], trial: [], renewal: [] },
  cancelled: { enrollment: ['cancelled', 'expired'], trial: ['cancelled'], renewal: ['withdrawn'] },
} as const satisfies Record<
  string,
  { enrollment: readonly string[]; trial: readonly string[]; renewal: readonly string[] }
>;

/** 拒絕只收這兩個：`awaiting_payment` 已經開了帳單，拒絕會留下一張沒人處理的帳單 */
const REJECTABLE = ['pending', 'waitlist'];

/**
 * 送申請的家長：電話取 `ba_user`、名字取本 org 的 `parents`（同一個帳號可能在別的 org 也是家長，
 * 由 `contactOf` 挑本 org 那筆）。`requested_by` 有 FK 指向 `ba_user`，直接 embed（#2230 ②）——
 * 原本另外撈齊 user id 再兩支 `.in()`，錯誤被吞、聯絡資訊整欄變 null。`ba_*` 可讀不可寫（c2）
 */
const REQUESTER = `requester:ba_user!requested_by(phone, parents(name, org_id))`;

export const SELECT = {
  enrollment: `id, status, preferred_start_date, note, reject_reason, requested_by, created_at,
    student_id, class_id, billing_mode, students(name),
    classes(name, campus_id, default_fee_template_id, campuses(name)), ${REQUESTER}`,
  trial: `id, status, preferred_times, note, requested_by, created_at,
    scheduled_date, scheduled_start_time, scheduled_end_time,
    student_id, students(name), courses(name, campus_id, campuses(name)), ${REQUESTER}`,
  // #1122 續課異動：目標是那筆報名的班（分校範圍同報名申請看班的 campus_id）
  renewal: `id, status, kind, detail, note, resolution_note, requested_by, created_at,
    student_id, students(name), enrollments(classes(name, campus_id, campuses(name))), ${REQUESTER}`,
} as const;
const TABLE = {
  enrollment: 'enrollment_requests',
  trial: 'trial_requests',
  renewal: 'renewal_requests',
} as const;
type Kind = keyof typeof TABLE;

const RequestSchema = z
  .object({
    id: DbUuidSchema,
    kind: z.enum(['enrollment', 'trial', 'renewal']),
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
    /** 報名才有（核准對話框用，#1726）：開課班、家長選的繳費週期、班級預設價目表（只用於預選） */
    classId: z.string().nullable(),
    billingMode: z.enum(['monthly', 'period', 'session_pack']).nullable(),
    defaultFeeTemplateId: z.string().nullable(),
    /** 試聽才有（#1747）：排定的日期（YYYY-MM-DD）與時間（HH:MM）；報名、還沒排都是 null */
    scheduledDate: z.string().nullable(),
    scheduledStartTime: z.string().nullable(),
    scheduledEndTime: z.string().nullable(),
    /** 續課異動才有（#1122）：轉班／停課（不續報）／變更繳費方式、想怎麼改、結案備註 */
    renewalKind: z.enum(['transfer', 'stop', 'billing_mode']).nullable(),
    detail: z.string().nullable(),
    resolutionNote: z.string().nullable(),
  })
  .openapi('ParentRequest');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentRequestAdminError');

type Row = Record<string, any>;
const one = (v: unknown): Row | null => (Array.isArray(v) ? v[0] : v) ?? null;
const targetOf = (kind: Kind, row: Row) =>
  kind === 'renewal'
    ? one(one(row['enrollments'])?.['classes'])
    : one(kind === 'enrollment' ? row['classes'] : row['courses']);

/** 稽核用：試聽才帶排定的日期與時間 */
const scheduleOf = (kind: Kind, row: Row) =>
  kind === 'trial'
    ? {
        scheduledDate: row['scheduled_date'] ?? null,
        scheduledStartTime: hhmm(row['scheduled_start_time']),
        scheduledEndTime: hhmm(row['scheduled_end_time']),
      }
    : {};

function visible(kind: Kind, row: Row, scope: CampusScope): boolean {
  if (scope === null) return true;
  const campusId = targetOf(kind, row)?.['campus_id'] as string | undefined;
  return !!campusId && scope.includes(campusId);
}

interface Contact {
  name: string | null;
  phone: string | null;
}

function contactOf(row: Row, orgId: string): Contact {
  const user = one(row['requester']);
  const parent = ((user?.['parents'] as Row[] | null | undefined) ?? []).find(
    (p) => p['org_id'] === orgId,
  );
  return {
    name: (parent?.['name'] as string | undefined) ?? null,
    phone: (user?.['phone'] as string | null | undefined) ?? null,
  };
}

function toResponse(kind: Kind, row: Row, orgId: string) {
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
    parent: contactOf(row, orgId),
    target: {
      name: (target?.['name'] as string | undefined) ?? '',
      campusName: (one(target?.['campuses'])?.['name'] as string | undefined) ?? null,
    },
    preferredStartDate: (row['preferred_start_date'] as string | null) ?? null,
    preferredTimes: (row['preferred_times'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    rejectReason: (row['reject_reason'] as string | null) ?? null,
    classId: (row['class_id'] as string | null | undefined) ?? null,
    billingMode:
      (row['billing_mode'] as 'monthly' | 'period' | 'session_pack' | null | undefined) ?? null,
    defaultFeeTemplateId:
      (target?.['default_fee_template_id'] as string | null | undefined) ?? null,
    scheduledDate: (row['scheduled_date'] as string | null | undefined) ?? null,
    scheduledStartTime: hhmm(row['scheduled_start_time']),
    scheduledEndTime: hhmm(row['scheduled_end_time']),
    renewalKind: kind === 'renewal' ? (row['kind'] as 'transfer' | 'stop' | 'billing_mode') : null,
    detail: (row['detail'] as string | null | undefined) ?? null,
    resolutionNote: (row['resolution_note'] as string | null | undefined) ?? null,
  };
}

/** DB 的 time 是 `HH:MM:SS`，回 `HH:MM`（同 routes/parent/trial-requests.ts） */
const hhmm = (t: unknown) => (typeof t === 'string' ? t.slice(0, 5) : null);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

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
        kind: z.enum(['enrollment', 'trial', 'renewal']).optional(),
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
    const kinds = (kind ? [kind] : ['enrollment', 'trial', 'renewal']) as Kind[];
    const scope = getCampusScope(c);

    // ponytail: 分校範圍在記憶體濾、不分頁 —— 同 public-applications，一間補習班的待處理申請是個位數到幾十筆
    const results = await Promise.all(
      kinds.map(async (k) => {
        const statuses = GROUPS[group][k] as readonly string[];
        if (statuses.length === 0) return { k, rows: [] as Row[], error: null };
        // 直接 `.eq('org_id')` 不經 `inOrg`：embed 的 builder 交給 inOrg 會撞 TS2589（同 public-applications）
        // 撈齊（#2230 ②）：done／cancelled 是歷史累積，一次撈會被 max_rows（1000）截斷
        const { rows, error } = await fetchAllPages((from, to) =>
          supabase
            .from(TABLE[k])
            // 收窄成 string：三種 select 字串的聯集讓 postgrest 的型別推導撞 TS2589
            .select(SELECT[k] as string)
            .eq('org_id', orgId)
            .in('status', [...statuses])
            .order('id')
            .range(from, to),
        );
        return { k, rows: (rows as Row[]).filter((r) => visible(k, r, scope)), error };
      }),
    );
    if (results.some((r) => r.error)) {
      return c.json({ error: '讀取家長申請失敗', code: 'FETCH_FAILED' }, 500);
    }

    const data = results
      .flatMap((r) => r.rows.map((row) => toResponse(r.k, row, orgId)))
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
      params: z.object({ kind: z.enum(['enrollment', 'trial', 'renewal']), id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              status: z.string(),
              /** 報名拒絕時必填，家長看得到 */
              rejectReason: z.string().trim().max(500).optional(),
              /** 試聽轉「已排定」時必填（#1747）；時間選填。已排定再送一次＝改期，整組換掉 */
              scheduledDate: z.string().date().optional(),
              scheduledStartTime: HHMM.optional(),
              scheduledEndTime: HHMM.optional(),
              /** 續課異動結案時的備註（選填，#1122） */
              resolutionNote: z.string().trim().max(200).optional(),
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
        description: '狀態不合法、缺拒絕原因，或試聽排定缺日期／時間不合法',
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
    } else if (kind === 'renewal') {
      // #1122：管理員只做一件事 —— 標為已處理（＝解除這個學生的暫停）。撤回是家長的動作
      if (body.status !== 'resolved') return invalid('續課異動在這裡只能標為已處理');
      patch['resolution_note'] = body.resolutionNote || null;
      patch['resolved_by'] = c.get('userId');
      patch['resolved_at'] = new Date().toISOString();
    } else if (!(TRIAL_STATUSES as readonly string[]).includes(body.status)) {
      return invalid('試聽狀態不合法');
    } else {
      // #1747（計畫席 10-22）：轉已排定日期必填、時間選填；轉回待處理清空；完成／取消保留。
      // 時間的規則跟 DB CHECK 同一套，這裡先擋成 400，不讓 CHECK 噴 500
      const { scheduledDate: date, scheduledStartTime: start, scheduledEndTime: end } = body;
      const badSchedule = (error: string) => c.json({ error, code: 'INVALID_SCHEDULE' }, 400);
      if (body.status === 'scheduled') {
        if (!date) return badSchedule('排定試聽要填日期');
        if (end && (!start || end <= start)) return badSchedule('結束時間要晚於開始時間');
        patch['scheduled_date'] = date;
        patch['scheduled_start_time'] = start ?? null;
        patch['scheduled_end_time'] = end ?? null;
      } else if (date || start || end) {
        return badSchedule('日期與時間只在排定時填');
      } else if (body.status === 'pending') {
        patch['scheduled_date'] = null;
        patch['scheduled_start_time'] = null;
        patch['scheduled_end_time'] = null;
      }
    }

    const { data: before } = await supabase
      .from(TABLE[kind])
      .select(SELECT[kind] as string) // 同 GET：收窄避開 TS2589
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
    const renewalClosed = { error: '這筆續課異動已經結案或被撤回', code: 'NOT_PENDING' } as const;
    if (kind === 'renewal' && prev['status'] !== 'pending') return c.json(renewalClosed, 409);

    // 報名的拒絕帶上「狀態還是可拒絕」當條件：讀完到寫入之間別人可能已經核准了（#1726 上線後就會發生），
    // 沒寫到任何一列就是被搶先了 → 409，不蓋掉已經開了帳單的那一筆（審核席 #1728 建議）
    // 直接 `.eq('org_id')` 不經 `inOrg`：條件式的 builder 交給 inOrg 會撞 TS2589（同上面的讀取）
    const update = supabase.from(TABLE[kind]).update(patch).eq('org_id', orgId).eq('id', id);
    const { data: written, error } = await (
      kind === 'enrollment'
        ? update.in('status', REJECTABLE)
        : kind === 'renewal'
          ? update.eq('status', 'pending') // 家長同時撤回的話不蓋掉
          : update
    ).select('id');
    if (error) return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 500);
    if (kind === 'renewal' && (!written || (written as unknown[]).length === 0)) {
      return c.json(renewalClosed, 409);
    }
    if (!written || (written as unknown[]).length === 0) {
      return c.json({ error: '這筆申請已經不是待審核，不能拒絕', code: 'NOT_REJECTABLE' }, 409);
    }

    const after = { ...prev, ...patch };
    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        // 續課異動記在學生名下（gate：不動 audit_logs_resource_type_check）
        resourceType:
          kind === 'enrollment'
            ? 'enrollment_request'
            : kind === 'trial'
              ? 'trial_request'
              : 'student',
        resourceId: kind === 'renewal' ? (prev['student_id'] as string) : id,
        resourceName: `${one(prev['students'])?.['name'] ?? ''}（${targetOf(kind, prev)?.['name'] ?? ''}）`,
        action: 'update',
        details: {
          ...(kind === 'renewal' ? { renewalRequestId: id } : {}),
          before: {
            status: prev['status'],
            rejectReason: prev['reject_reason'] ?? null,
            ...scheduleOf(kind, prev),
          },
          after: {
            status: after['status'],
            rejectReason: after['reject_reason'] ?? null,
            ...scheduleOf(kind, after),
          },
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: toResponse(kind, after, orgId) }, 200);
  },
);

// POST /api/parent-requests/enrollment/{id}/approve —— 核准報名申請（#1726）
const ApproveSchema = z
  .object({
    billingMode: z.enum(['monthly', 'period', 'session_pack']),
    feeTemplateId: DbUuidSchema,
    /** 議定價；填了要附原因（enrollment-rules 5.3） */
    agreedAmount: z.number().int().min(0).optional(),
    adjustmentNote: z.string().trim().min(1).max(500).optional(),
    effectiveFrom: z.string().date(),
    /** 行政改過的首期金額；不給 = 伺服器試算值。跟試算不同要附 `amountNote` */
    amount: z.number().int().min(0).optional(),
    amountNote: z.string().trim().max(500).optional(),
    /** 不給 = 開帳日 + 機構設定天數 */
    dueDate: z.string().date().optional(),
    /** 堂數制必填 */
    sessionCount: z.number().int().min(1).max(1000).optional(),
    skipConflictCheck: z.boolean().optional(),
  })
  .refine((v) => v.agreedAmount === undefined || Boolean(v.adjustmentNote), {
    message: '議定金額要寫原因',
    path: ['adjustmentNote'],
  })
  .refine((v) => v.billingMode !== 'session_pack' || v.sessionCount !== undefined, {
    message: '堂數制要填堂數',
    path: ['sessionCount'],
  });

app.openapi(
  createRoute({
    method: 'post',
    path: '/enrollment/{id}/approve',
    tags: ['ParentRequests'],
    summary: '核准家長的報名申請：建待繳費報名、開帳單、申請轉待付款（一個交易）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: ApproveSchema } } },
    },
    responses: {
      200: {
        description: '已核准',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({
                enrollmentId: z.string(),
                invoiceId: z.string(),
                invoiceNo: z.string().nullable(),
                amount: z.number(),
                dueDate: z.string(),
              }),
            }),
          },
        },
      },
      400: {
        description: '價目表不符、金額改了沒寫原因、金額 0、期限早於開帳日',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '沒有財務權限',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '不存在或不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '不是待審核／候補、額滿、已在班上、撞課、沒有涵蓋的繳費期',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // 會開帳單：收件頁的 manage_students 之外還要 manage_finance（Q6）
    if (!hasPermission(c.get('permissions') ?? [], 'manage_finance')) {
      return c.json({ error: '核准會開帳單，需要財務權限', code: 'FINANCE_REQUIRED' }, 403);
    }
    const pool = getAuth(c).pool;
    if (!pool) return c.json({ error: '核准失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);

    const issuedAt = getCurrentTaipeiDateString();
    if (body.dueDate && body.dueDate < issuedAt) {
      return c.json({ error: '繳費期限不能早於開帳日', code: 'DUE_BEFORE_ISSUE' }, 400);
    }

    const scope = getCampusScope(c);
    const { data: found, error: readError } = await supabase
      .from(TABLE.enrollment)
      .select(SELECT.enrollment)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (readError) return c.json({ error: '核准失敗', code: 'SERVER_ERROR' }, 500);
    if (!found || !visible('enrollment', found as Row, scope)) {
      return c.json({ error: '找不到這筆申請', code: 'NOT_FOUND' }, 404);
    }
    const prev = found as Row;

    // 撞課是提醒不是守門（同直接報名）：列出來，行政勾「仍要報名」再送
    if (!body.skipConflictCheck) {
      const pre = await checkEnrollmentPreconditions({
        supabase,
        orgId,
        classId: prev['class_id'] as string,
        studentIds: [prev['student_id'] as string],
        effectiveFrom: body.effectiveFrom,
        effectiveTo: null,
        scope,
      });
      if (pre.error?.code === 'SERVER_ERROR') {
        return c.json({ error: '核准失敗', code: 'SERVER_ERROR' }, 500);
      }
      if (pre.conflicts.length > 0) {
        return c.json(
          {
            error: '跟孩子的其他班撞時間',
            code: 'SCHEDULE_CONFLICT',
            details: { conflicts: [...pre.conflicts] },
          },
          409,
        );
      }
    }

    let r: Awaited<ReturnType<typeof approveEnrollmentRequest>>;
    try {
      r = await approveEnrollmentRequest(pool, {
        orgId,
        userId,
        requestId: id,
        scope,
        billingMode: body.billingMode,
        feeTemplateId: body.feeTemplateId,
        agreedAmount: body.agreedAmount ?? null,
        adjustmentNote: body.adjustmentNote ?? null,
        effectiveFrom: body.effectiveFrom,
        amount: body.amount ?? null,
        amountNote: body.amountNote ?? null,
        issuedAt,
        dueDate: body.dueDate ?? null,
        sessionCount: body.sessionCount ?? null,
      });
    } catch (err) {
      console.error('[parent-requests] approve failed', err);
      return c.json({ error: '核准失敗', code: 'SERVER_ERROR' }, 500);
    }

    switch (r.status) {
      case 'not-found':
        return c.json({ error: '找不到這筆申請', code: 'NOT_FOUND' }, 404);
      case 'not-approvable':
        return c.json({ error: '這筆申請已經不是待審核', code: 'NOT_APPROVABLE' }, 409);
      case 'class-full':
        return c.json({ error: '這班已額滿', code: 'CLASS_FULL' }, 409);
      case 'already-enrolled':
        return c.json({ error: '孩子已經在這班', code: 'ALREADY_ENROLLED' }, 409);
      case 'no-billing-period':
        return c.json({ error: '沒有涵蓋開始日期的繳費期', code: 'NO_BILLING_PERIOD' }, 409);
      case 'invalid-fee-template':
        return c.json(
          { error: '價目表不存在、已停用或計費方式不符', code: 'INVALID_FEE_TEMPLATE' },
          400,
        );
      case 'amount-note-required':
        return c.json(
          {
            error: '首期金額跟試算不同，要寫原因',
            code: 'AMOUNT_NOTE_REQUIRED',
            details: { suggested: r.suggested },
          },
          400,
        );
      case 'zero-amount':
        return c.json({ error: '首期金額不能是 0', code: 'ZERO_AMOUNT' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'enrollment_request',
        resourceId: id,
        resourceName: `${one(prev['students'])?.['name'] ?? ''}（${targetOf('enrollment', prev)?.['name'] ?? ''}）`,
        action: 'approve',
        details: {
          before: { status: prev['status'] },
          after: { status: 'awaiting_payment' },
          enrollment_id: r.enrollmentId,
          invoice_id: r.invoiceId,
          invoice_no: r.invoiceNo,
          billing_mode: body.billingMode,
          fee_template_id: body.feeTemplateId,
          amount: r.amount,
          due_date: r.dueDate,
        },
      },
      waitUntilFrom(c),
    );

    // 通知家長（Q1 (b)，站內＋推播）。背景跑、不擋回應；失敗只記 log
    const job = notifyEnrollmentApproved(supabase, {
      orgId,
      requestId: id,
      studentId: r.studentId,
      studentName: (one(prev['students'])?.['name'] as string | undefined) ?? '',
      className: (targetOf('enrollment', prev)?.['name'] as string | undefined) ?? '',
      amount: r.amount,
      dueDate: r.dueDate,
    });
    const wu = waitUntilFrom(c);
    if (wu) wu(job);
    else await job;

    return c.json(
      {
        data: {
          enrollmentId: r.enrollmentId,
          invoiceId: r.invoiceId,
          invoiceNo: r.invoiceNo,
          amount: r.amount,
          dueDate: r.dueDate,
        },
      },
      200,
    );
  },
);

export default app;
