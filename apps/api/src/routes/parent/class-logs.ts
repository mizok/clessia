import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { CLASS_LOG_SELECT, toClassLogResponse } from '../../lib/class-log-query';
import { countEnrolledOn, type EnrollmentRange } from '../../lib/session-roster';
import { sliceDerivedPage } from '../../lib/derived-page';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端讀取「已發布」教務日誌。複用 `routes/class-logs.ts`（admin）的 select
 * 與 mapper（`lib/class-log-query.ts`），換掉查詢用的 client（`supabase` →
 * `childDb`），再過一層 allowlist 砍掉內部欄位（不回 `teachingRecord`）。
 * 見 kb/wiki/architecture/parent-class-logs-read.md。
 *
 * `class_logs` 是**班級層級**不是學生層級，`childDb.from()` 假設表上有
 * `student_id` 欄位在這裡不成立 —— 先用 `pluck()` 從 `enrollments` 拿到
 * 這個孩子在籍過的 `class_id` 清單（品牌化成 `ScopedIds`），再用
 * `fromScopedIds()` 查 `class_logs`。
 */

const ParentClassLogRecordSchema = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    className: z.string().nullable(),
    logDate: z.string(),
    homework: z.string(),
    // `publishedAt` 這裡一定非 null —— 查詢條件已經濾掉草稿
    publishedAt: z.string(),
    lastEditedByName: z.string().nullable(),
    // teachingRecord 不回：定案是「教學紀錄一律內部」，紙本現實是「老師會寫不給家長看的話」
  })
  .openapi('ParentClassLogRecord');

const ListResponseSchema = z
  .object({
    data: z.array(ParentClassLogRecordSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      /** 過去 7 天內發布的篇數，跟 GET /api/me/grades 的 recentCount 同一個判準 */
      recentCount: z.number().int().min(0),
    }),
  })
  .openapi('ParentClassLogListResponse');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentClassLogError');

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `class_logs` 候選集合的上限。`countEnrolledOn` 的過濾要等資料撈回來**之後**
 * 才能判斷，DB 分頁會把「這一頁 20 筆」的 20 筆裡混進之後會被過濾掉的列，
 * 所以撈一個較寬鬆的候選集合、不下 `range()`，過濾後才在記憶體裡切頁
 * （跟 `attendance.ts` / `sessions.ts` 的 `endedOnly` 同一個形狀）。
 *
 * 一個孩子讀滿 3 年、跨 5 個班，一天一篇也才約 750 個上課日 —— 500 對 v1
 * 的實際量級留了餘裕，數字本身不是精算，是「肉眼可判斷夠不夠」的量級。
 * **真的頂到這個上限時**（`enrolledClassIds` 涵蓋的班級數 × 日誌篇數超出預期），
 * 該做的是改用 `logDate` 區間分段掃（例如每次只掃 90 天）取代一次全撈，
 * 不是無限拉高上限。
 */
const CLASS_LOG_CANDIDATE_LIMIT = 500;

function toParentClassLogRecord(row: Record<string, unknown>) {
  const full = toClassLogResponse(row);
  return {
    id: full.id,
    classId: full.classId,
    className: full.className,
    logDate: full.logDate,
    homework: full.homework,
    // 查詢條件已經濾掉草稿，這裡不會是 null —— 但 toClassLogResponse 的型別
    // 是共用的（admin 端可以是 null），用 `!` 前先讓呼叫端自己保證前提成立
    publishedAt: full.publishedAt as string,
    lastEditedByName: full.lastEditedByName,
  };
}

interface EnrollmentPluckRow {
  class_id: string;
  effective_from: string;
  effective_to: string | null;
}

function toEnrollmentRanges(rows: readonly Record<string, unknown>[]): EnrollmentRange[] {
  return (rows as unknown as EnrollmentPluckRow[]).map((row) => ({
    classId: row.class_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }));
}

/**
 * 這一筆 `class_logs` 那一天是不是真的落在孩子的在籍區間內。
 *
 * **這條防線是為了轉班**：孩子從 A 班轉到 B 班，只用「曾經在籍過的班級清單」
 * 查 `class_logs`，會看到 A 班在他離開之後、或 B 班在他加入之前寫的日誌 ——
 * 那是過度曝光（別班在他不在的時候寫了什麼，跟他無關）。
 */
function filterByEnrollment(
  rows: readonly Record<string, unknown>[],
  enrollmentRanges: readonly EnrollmentRange[],
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const classId = row['class_id'] as string;
    const logDate = row['log_date'] as string;
    return countEnrolledOn(enrollmentRanges, classId, logDate) > 0;
  });
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/class-logs
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子已發布的教務日誌',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
        page: z.coerce.number().int().min(1).default(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ListResponseSchema } } },
      403: {
        description: '不是家長身分或這個孩子不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }

    const { childId, dateFrom, dateTo, page = 1, pageSize = 20 } = c.req.valid('query');

    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const childDb = c.get('childDb');

    const {
      rows: enrollmentRows,
      ids: classIds,
      error: enrollmentError,
    } = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id, effective_from, effective_to', 'class_id');

    if (enrollmentError) {
      return c.json({ error: '讀取教務日誌失敗', code: 'FETCH_CLASS_LOGS_FAILED' }, 500);
    }

    const enrollmentRanges = toEnrollmentRanges(enrollmentRows);

    if (classIds.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize, recentCount: 0 } }, 200);
    }

    let candidateQuery = childDb
      .fromScopedIds('class_logs', 'class_id', classIds)
      .select(CLASS_LOG_SELECT)
      .not('published_at', 'is', null)
      .order('log_date', { ascending: false })
      .limit(CLASS_LOG_CANDIDATE_LIMIT);
    if (dateFrom) candidateQuery = candidateQuery.gte('log_date', dateFrom);
    if (dateTo) candidateQuery = candidateQuery.lte('log_date', dateTo);

    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const recentQuery = childDb
      .fromScopedIds('class_logs', 'class_id', classIds)
      .select('class_id, log_date')
      .not('published_at', 'is', null)
      .gte('published_at', recentSince);

    const [{ data, error }, { data: recentData, error: recentError }] = await Promise.all([
      candidateQuery,
      recentQuery,
    ]);

    if (error || recentError) {
      return c.json({ error: '讀取教務日誌失敗', code: 'FETCH_CLASS_LOGS_FAILED' }, 500);
    }

    const candidateRows = (data ?? []) as unknown as Record<string, unknown>[];
    const filteredRows = filterByEnrollment(candidateRows, enrollmentRanges);

    const recentRows = (recentData ?? []) as unknown as Record<string, unknown>[];
    const recentCount = filterByEnrollment(recentRows, enrollmentRanges).length;

    const { rows, total } = sliceDerivedPage(filteredRows, page, pageSize);

    return c.json(
      {
        data: rows.map(toParentClassLogRecord),
        meta: { total, page, pageSize, recentCount },
      },
      200,
    );
  },
);

export default app;
