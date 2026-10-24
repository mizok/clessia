import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';
import {
  countDeductedSessions,
  remainingSessions,
  type AttendanceStatus,
} from '../lib/session-pack';
import { DbUuidSchema } from '../lib/validation';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import type { Queryable } from '../lib/identity-sql';
import { attendanceStatusesViaSql } from '../lib/session-pack-sql';

/**
 * 堂數包：買 N 堂慢慢上完。
 *
 * **剩餘堂數是推導的**（`lib/session-pack.ts`）。這支路由的工作是把推導需要的三樣
 * 東西湊齊：買了幾包、這個報名的班有哪些出勤記錄、這個班請假扣不扣堂。
 *
 * 見 kb/wiki/rules/billing-rules.md 規則 1 與 8。
 */

const SessionPackSchema = z
  .object({
    id: DbUuidSchema,
    enrollmentId: DbUuidSchema,
    purchasedCount: z.number(),
    purchasedAt: z.string(),
    expiresAt: z.string().nullable(),
    invoiceItemId: DbUuidSchema.nullable(),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('SessionPack');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('SessionPackError');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toSessionPack(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    enrollmentId: row['enrollment_id'] as string,
    purchasedCount: Number(row['purchased_count']),
    purchasedAt: row['purchased_at'] as string,
    expiresAt: (row['expires_at'] as string | null) ?? null,
    invoiceItemId: (row['invoice_item_id'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

/**
 * 把某個報名的堂數帳算出來。
 *
 * **出勤記錄一定要濾到這個報名的班**：`attendance_records` 是 (event, student) 粒度，
 * 要經 `sessions.event_id → sessions.class_id` 對到 enrollment 的班。不濾的話會把別班
 * 的出席也算進來 —— daily_checkin 模式尤其明顯，那個模式的衍生記錄是「當天分校**所有**
 * events」（`routes/daily-checkins.ts`），一天可能替好幾個班各建一筆。
 */
type SessionPackResponse = ReturnType<typeof toSessionPack>;

interface EnrollmentSessionSummary {
  packs: SessionPackResponse[];
  purchased: number;
  deducted: number;
  remaining: number;
  leaveDeductsSession: boolean;
}

/**
 * 讀取失敗（#1928）：剩餘堂數會被拿去判斷要不要續購或收費，讀不到就不能回一個算出來的數字 ——
 * 原本每支只拿 `data`，堂數包讀不到時剩餘變負數（像該追補買），出勤讀不到時已扣 0（剩餘＝已購）。
 */
type ReadFailure = { error: 'READ_FAILED'; step: string; message: string };
const readFailed = (step: string, err: { message?: string }): ReadFailure => ({
  error: 'READ_FAILED',
  step,
  message: err.message ?? 'unknown',
});

async function summariseEnrollment(
  supabase: SupabaseClient,
  enrollmentId: string,
  orgId: string,
  db: Queryable | undefined,
): Promise<{ error: 'NOT_FOUND' } | ReadFailure | EnrollmentSessionSummary> {
  const { data: enrollment, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('id, class_id, student_id, classes(leave_deducts_session)')
    .eq('id', enrollmentId)
    .eq('org_id', orgId)
    .maybeSingle();

  // 讀不到 ≠ 不存在
  if (enrollmentError) return readFailed('報名', enrollmentError);
  if (!enrollment) return { error: 'NOT_FOUND' };

  const leaveDeductsSession = Boolean(
    (enrollment['classes'] as { leave_deducts_session?: boolean } | null)?.leave_deducts_session,
  );

  const { data: packRows, error: packError } = await supabase
    .from('session_packs')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .order('purchased_at', { ascending: false });
  if (packError) return readFailed('堂數包', packError);

  const packs: SessionPackResponse[] = (packRows ?? []).map((row) =>
    toSessionPack(row as Record<string, unknown>),
  );

  // 這個班的所有 session 對應的 event —— 出勤記錄要靠它濾班
  //
  // **停課的課堂不算**（使用者 2026-09-06 裁定 2(b)，issue #485）。
  //
  // 使用者裁的原話是「**看有沒有補課 —— 補了才扣，沒補不扣**」。而計畫席查證後
  // 回報了一個限制：**這個系統裡沒有「補課」這個概念** —— `schedule_changes` 的
  // `change_type` 只有 `reschedule` / `substitute` / `cancellation` / `uncancel` /
  // `time_change`。課要嘛被**改期**（`reschedule`，課本身沒停，在新日期正常上、
  // 正常扣），要嘛被**停課**（`cancellation`，沒有任何東西接續它）。
  // **不存在「停課 A 之後補了 B、兩者相連」這種資料。**
  //
  // 所以這條裁示在現行模型下的實際行為等於「不扣」——**不是因為規則是不扣，
  // 是因為「補了」這個狀態現在無法成立**。
  //
  // ⚠️ **將來新增補課功能時，這裡要跟著改，而不是重新討論規則。**
  // 規則已經裁定過了（補了才扣），改的是「怎麼判斷補了」。
  //
  // 為什麼這一道守在扣課側而不是只靠掃碼側（#498）：停課只改 `sessions.status`，
  // 那筆 event 與它上面**已經存在的** `attendance_records` 都留著。掃碼側的過濾
  // 只擋得住之後新寫的，**擋不住老師在停課之前就點好的名**，也擋不住請假連動寫下
  // 的 `on_leave`（`routes/leaves.ts` 走另一條路）。這一道是「不論那筆紀錄從哪裡
  // 來」的最後一關 —— 它守的是金額。
  let statuses: AttendanceStatus[] = [];
  if (db) {
    // 正式環境：一條 SQL 數好（不把班級歷來所有 event 塞進網址、也不受 1000 列截斷，#1928）
    try {
      statuses = await attendanceStatusesViaSql(db, {
        orgId,
        classId: enrollment['class_id'] as string,
        studentId: enrollment['student_id'] as string,
      });
    } catch (err) {
      return readFailed('出勤', { message: err instanceof Error ? err.message : String(err) });
    }
  } else {
    // 沒有 pool（單元測試的精簡 app）：原本的兩步 REST
    const { data: sessionRows, error: sessionError } = await supabase
      .from('sessions')
      .select('event_id')
      .eq('class_id', enrollment['class_id'])
      .neq('status', 'cancelled')
      .not('event_id', 'is', null);
    if (sessionError) return readFailed('課堂', sessionError);

    const eventIds = (sessionRows ?? [])
      .map((row) => (row as Record<string, unknown>)['event_id'] as string)
      .filter(Boolean);

    if (eventIds.length > 0) {
      const { data: attendanceRows, error: attendanceError } = await supabase
        .from('attendance_records')
        .select('status')
        .eq('student_id', enrollment['student_id'])
        .in('event_id', eventIds);
      if (attendanceError) return readFailed('出勤', attendanceError);

      statuses = (attendanceRows ?? []).map(
        (row) => (row as Record<string, unknown>)['status'] as AttendanceStatus,
      );
    }
  }

  return {
    packs,
    purchased: packs.reduce((sum, pack) => sum + pack.purchasedCount, 0),
    deducted: countDeductedSessions(statuses, leaveDeductsSession),
    remaining: remainingSessions(packs, statuses, leaveDeductsSession),
    leaveDeductsSession,
  };
}

const app = new OpenAPIHono<AppEnv>();

// ============================================================
// GET /api/session-packs?enrollmentId=...
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['SessionPacks'],
    summary: '某個報名的堂數帳（含推導出的剩餘堂數）',
    request: { query: z.object({ enrollmentId: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(SessionPackSchema),
              summary: z.object({
                purchased: z.number(),
                deducted: z.number(),
                /** 可以是負數 —— 堂數用完不硬擋上課，負數就是該追補買的訊號 */
                remaining: z.number(),
                leaveDeductsSession: z.boolean(),
              }),
            }),
          },
        },
      },
      404: { description: '報名不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: {
        description: '讀取失敗（#1928），不回算錯的剩餘堂數',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { enrollmentId } = c.req.valid('query');

    const result = await summariseEnrollment(supabase, enrollmentId, orgId, c.get('auth')?.pool);

    if ('error' in result) {
      if (result.error === 'READ_FAILED') {
        console.error(`[session-packs] ${result.step}讀取失敗：${result.message}`);
        return c.json({ error: '讀取堂數資料失敗，請稍後再試', code: 'READ_FAILED' }, 500);
      }
      return c.json({ error: '報名不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json(
      {
        data: result.packs,
        summary: {
          purchased: result.purchased,
          deducted: result.deducted,
          remaining: result.remaining,
          leaveDeductsSession: result.leaveDeductsSession,
        },
      },
      200,
    );
  },
);

// ============================================================
// POST /api/session-packs —— 買一包
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['SessionPacks'],
    summary: '記錄一次堂數購買',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              enrollmentId: DbUuidSchema,
              purchasedCount: z.number().int().positive(),
              purchasedAt: z.string().regex(DATE).optional(),
              // 受訪公司不設效期，通用設計留空間（規則 1）
              expiresAt: z.string().regex(DATE).nullable().optional(),
              invoiceItemId: DbUuidSchema.optional(),
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: SessionPackSchema }) } },
      },
      400: { description: '驗證錯誤', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '報名不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('id', body.enrollmentId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!enrollment) {
      return c.json({ error: '報名不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data, error } = await supabase
      .from('session_packs')
      .insert({
        org_id: orgId,
        enrollment_id: body.enrollmentId,
        purchased_count: body.purchasedCount,
        // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭
        purchased_at: body.purchasedAt ?? getCurrentTaipeiDateString(),
        expires_at: body.expiresAt ?? null,
        invoice_item_id: body.invoiceItemId ?? null,
        note: body.note ?? null,
        created_by: userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      return c.json({ error: error?.message ?? '建立失敗', code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'session_pack',
        resourceId: data['id'] as string,
        action: 'create',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: toSessionPack(data as Record<string, unknown>) }, 201);
  },
);

// ============================================================
// DELETE /api/session-packs/:id —— 買錯了
// ============================================================
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['SessionPacks'],
    summary: '刪除一筆堂數購買',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    const { data: existing } = await supabase
      .from('session_packs')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existing) {
      return c.json({ error: '堂數記錄不存在', code: 'NOT_FOUND' }, 404);
    }

    await supabase.from('session_packs').delete().eq('id', id).eq('org_id', orgId);

    logAudit(
      supabase,
      { orgId, userId, resourceType: 'session_pack', resourceId: id, action: 'delete' },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 200);
  },
);

export default app;
