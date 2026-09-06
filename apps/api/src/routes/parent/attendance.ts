import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import {
  ATTENDANCE_SELECT,
  flattenAttendanceRow,
  toAttendanceResponse,
} from '../../lib/attendance-query';
import { DbUuidSchema } from '../../lib/validation';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';

/**
 * 家長端的出缺席列表。複用 `routes/attendance.ts`（admin）的 select 與 mapper
 * （`lib/attendance-query.ts`），換掉查詢用的 client（`supabase` → `childDb`），
 * 再過一層 allowlist 砍掉內部欄位。見 kb/wiki/architecture/parent-read-endpoints.md。
 */

const ParentAttendanceRecordSchema = z
  .object({
    id: DbUuidSchema,
    eventId: DbUuidSchema,
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    campusName: z.string().nullable(),
    className: z.string().nullable(),
    /**
     * **課堂本身**的狀態。停課的課堂上面仍然可能有一筆 `on_leave`
     * （請假在停課之前送的），少了這個欄位家長會把它讀成一次正常的請假 ——
     * 而老師端同一件事有「停課」標籤（#502）。
     */
    sessionStatus: z.enum(['scheduled', 'completed', 'cancelled']).nullable(),
    status: z.enum(['present', 'absent', 'on_leave']),
    note: z.string().nullable(),
    // recordedBy / recordedByRole 不回：內部經手人 id 與角色標記，
    // 對家長是無意義的亂碼，窗口裁決已補進遮蔽清單
  })
  .openapi('ParentAttendanceRecord');

const ListResponseSchema = z
  .object({
    data: z.array(ParentAttendanceRecordSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      /**
       * 這個孩子本月（自然月，到今天為止）**缺席**的筆數。
       *
       * **跟請假分開回，不合計** —— 請假是家長自己送出的，他已經知道；
       * 缺席是他可能不知道的。合成一個數字會把唯一需要他反應的訊號
       * 稀釋進他早就知道的事情裡。
       */
      monthlyAbsentCount: z.number().int().min(0),
      /** 這個孩子本月（自然月，到今天為止）**請假**的筆數 */
      monthlyOnLeaveCount: z.number().int().min(0),
    }),
  })
  .openapi('ParentAttendanceListResponse');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentAttendanceError');

function toParentAttendanceRecord(row: Record<string, unknown>) {
  const full = toAttendanceResponse(row);
  return {
    id: full.id,
    eventId: full.eventId,
    eventDate: full.eventDate,
    startTime: full.startTime,
    endTime: full.endTime,
    campusName: full.campusName,
    className: full.className,
    sessionStatus: full.sessionStatus,
    status: full.status,
    note: full.note,
  };
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/attendance
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子的出缺席紀錄',
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
    const from = (page - 1) * pageSize;

    // `childDb` 的 `.in(idColumn, scope)` 只保證「這個家長全部孩子的範圍內」——
    // 一個家長有兩個孩子時，還要疊一層 `.eq()` 縮到這次要看的那一個，
    // 不然 childId=c1 會連 c2 的資料一起撈回來。
    let query = childDb
      .from('attendance_records', 'student_id')
      .select(ATTENDANCE_SELECT, { count: 'exact' })
      .eq('student_id', childId);
    if (dateFrom) query = query.gte('events.event_date', dateFrom);
    if (dateTo) query = query.lte('events.event_date', dateTo);
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

    const [{ data, error, count }, absentResult, onLeaveResult] = await Promise.all([
      query,
      childDb
        .from('attendance_records', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', childId)
        .eq('status', 'absent')
        .gte('events.event_date', monthStart()),
      childDb
        .from('attendance_records', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', childId)
        .eq('status', 'on_leave')
        .gte('events.event_date', monthStart()),
    ]);

    if (error || absentResult.error || onLeaveResult.error) {
      return c.json({ error: '讀取出缺席紀錄失敗', code: 'FETCH_ATTENDANCE_FAILED' }, 500);
    }

    const rawRows = (data ?? []) as unknown as Record<string, unknown>[];
    const rows = rawRows.map((r) => flattenAttendanceRow(r));

    return c.json(
      {
        data: rows.map(toParentAttendanceRecord),
        meta: {
          total: count ?? 0,
          page,
          pageSize,
          monthlyAbsentCount: absentResult.count ?? 0,
          monthlyOnLeaveCount: onLeaveResult.count ?? 0,
        },
      },
      200,
    );
  },
);

/** 這個月的第一天（自然月，Asia/Taipei） */
function monthStart(): string {
  return `${getCurrentTaipeiDateString().slice(0, 7)}-01`;
}

export default app;
