import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import {
  ATTENDANCE_SELECT,
  flattenAttendanceRow,
  toAttendanceResponse,
} from '../../lib/attendance-query';
import {
  LEAVE_WINDOW_COLUMNS,
  leaveCoversSession,
  toLeaveWindow,
} from '../../lib/leave-covers-session';
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
    /** 課堂的分校（#1075）：前端拿它對 `/checkins` 的 `dailyCheckinCampusIds` */
    campusId: z.string().nullable(),
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
    /**
     * 請假的堂（`on_leave`）是誰登記的：家長自己送的（`parent`）或補習班登記的（`school`）。
     * 不回是誰、不回 user id。不是請假、或找不到蓋到這堂的假單 → `null`（#1695 第 4 張）
     */
    leaveSubmittedBy: z.enum(['parent', 'school']).nullable(),
    /**
     * 請假原因。**只回家長自己送的**；補習班登記的一律 `null` —— 管理端的原因欄沒有告訴行政
     * 「家長看得到」，寫的可能是內部備註（計畫席 10-19 裁 (A)，升級到全部顯示待使用者裁定）。
     * 在 API 層就不回，不是只在前端藏
     */
    leaveReason: z.string().nullable(),
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

type Row = Record<string, unknown>;

function toParentAttendanceRecord(row: Row, leave: Row | null) {
  const full = toAttendanceResponse(row);
  const byParent = leave?.['submitted_by_role'] === 'parent';
  return {
    id: full.id,
    eventId: full.eventId,
    eventDate: full.eventDate,
    startTime: full.startTime,
    endTime: full.endTime,
    campusId: (row['campus_id'] as string | null) ?? null,
    campusName: full.campusName,
    className: full.className,
    sessionStatus: full.sessionStatus,
    status: full.status,
    note: full.note,
    leaveSubmittedBy: leave ? (byParent ? ('parent' as const) : ('school' as const)) : null,
    leaveReason: byParent ? ((leave?.['reason'] as string | null) ?? null) : null,
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
      // **`events` 要在 select 裡，因為下面對 `events.event_date` 下了條件。**
      // 原本是 `.select('id', …)`，PostgREST 對它回 400 `PGRST108`
      //（'events' is not an embedded resource in this request）—— 也就是這支端點
      // 對每一個家長、每一次呼叫都 500（#528）。
      // **`!inner` 不是裝飾**：少了它，條件會靜靜地什麼都不篩（見 lib/session-summary.ts
      // 的實測表）。同一個知識點的兩種失敗方向 —— 沒 embed 是大聲的 400，
      // 有 embed 沒 `!inner` 是安靜的全回。
      childDb
        .from('attendance_records', 'student_id')
        .select('id, events!inner(event_date)', { count: 'exact', head: true })
        .eq('student_id', childId)
        .eq('status', 'absent')
        .gte('events.event_date', monthStart()),
      childDb
        .from('attendance_records', 'student_id')
        .select('id, events!inner(event_date)', { count: 'exact', head: true })
        .eq('student_id', childId)
        .eq('status', 'on_leave')
        .gte('events.event_date', monthStart()),
    ]);

    if (error || absentResult.error || onLeaveResult.error) {
      return c.json({ error: '讀取出缺席紀錄失敗', code: 'FETCH_ATTENDANCE_FAILED' }, 500);
    }

    const rawRows = (data ?? []) as unknown as Row[];

    // 請假的堂是哪一張假蓋到的：出勤紀錄沒有連到假單，照管理端的判準（`leaveCoversSession`）推導。
    // 假單也走 childDb，而且疊 `.eq('student_id', childId)` —— 只讀這個孩子的（兄弟姊妹的假不能混進來）
    const eventOf = (r: Row) => (r['events'] ?? {}) as Row;
    const leaveDates = rawRows
      .filter((r) => r['status'] === 'on_leave')
      .map((r) => eventOf(r)['event_date'] as string)
      .sort();
    let leaves: Row[] = [];
    if (leaveDates.length > 0) {
      const leaveResult = await childDb
        .from('leave_requests', 'student_id')
        .select(`reason, submitted_by_role, ${LEAVE_WINDOW_COLUMNS}`)
        .eq('student_id', childId)
        .lte('start_date', leaveDates[leaveDates.length - 1]!)
        .gte('end_date', leaveDates[0]!);
      if (leaveResult.error) {
        return c.json({ error: '讀取出缺席紀錄失敗', code: 'FETCH_ATTENDANCE_FAILED' }, 500);
      }
      leaves = (leaveResult.data ?? []) as unknown as Row[];
    }
    const leaveFor = (r: Row): Row | null => {
      if (r['status'] !== 'on_leave') return null;
      const event = eventOf(r);
      const session = ((event['sessions'] ?? []) as Row[])[0];
      const window = {
        sessionId: (session?.['id'] as string | undefined) ?? null,
        date: event['event_date'] as string,
        startTime: (event['start_time'] as string | null) ?? null,
        endTime: (event['end_time'] as string | null) ?? null,
      };
      return leaves.find((l) => leaveCoversSession(toLeaveWindow(l), window)) ?? null;
    };

    return c.json(
      {
        data: rawRows.map((r) => toParentAttendanceRecord(flattenAttendanceRow(r), leaveFor(r))),
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

const CheckinsResponseSchema = z
  .object({
    /** 這段期間每一次到班：日期與台北時間。刷卡人、分校、列 id 都不回 —— 家長要的只有幾點到 */
    data: z.array(z.object({ date: z.string(), time: z.string() })),
    /**
     * 孩子報過名（任何狀態，過去的日子也要判）的班所在分校裡，生效模式是日到班的那些。
     * 前端拿它對出勤紀錄的 `campusId`：那天有任何一堂在這些分校才畫到班行（設計稿 §1）
     */
    dailyCheckinCampusIds: z.array(z.string()),
  })
  .openapi('ParentCheckinsResponse');

/** `checked_in_at`（timestamptz）→ 台北 `HH:mm`。台灣沒有日光節約，固定 +8 */
function taipeiTime(ts: string): string {
  return new Date(Date.parse(ts) + 8 * 3600_000).toISOString().slice(11, 16);
}

// GET /api/me/attendance/checkins（#1075）
app.openapi(
  createRoute({
    method: 'get',
    path: '/checkins',
    tags: ['Me'],
    summary: '這個孩子的每日到班時間',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        dateFrom: z.string().date(),
        dateTo: z.string().date(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: CheckinsResponseSchema } },
      },
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
    const { childId, dateFrom, dateTo } = c.req.valid('query');
    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const childDb = c.get('childDb');
    const fail = () => c.json({ error: '讀取到班紀錄失敗', code: 'FETCH_CHECKINS_FAILED' }, 500);

    // 疊 `.eq('student_id', childId)`：childDb 的範圍是這個家長的全部孩子（同列表那支）
    const [checkins, enrollments] = await Promise.all([
      childDb
        .from('daily_checkins', 'student_id')
        .select('checkin_date, checked_in_at')
        .eq('student_id', childId)
        .gte('checkin_date', dateFrom)
        .lte('checkin_date', dateTo)
        .order('checkin_date', { ascending: false }),
      childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id', childId),
    ]);
    if (checkins.error || enrollments.error) return fail();

    const classes =
      enrollments.ids.length === 0
        ? { data: [], error: null }
        : await childDb
            .orgRef('classes')
            .select('id, campus_id')
            .in('id', [...enrollments.ids]);
    if (classes.error) return fail();
    const campusIds = [
      ...new Set(
        ((classes.data ?? []) as unknown as Array<{ campus_id: string | null }>)
          .map((r) => r.campus_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const modes = await childDb.dailyCheckinCampusIds(campusIds);
    if (modes.error) return fail();

    return c.json(
      {
        data: ((checkins.data ?? []) as unknown as Row[]).map((r) => ({
          date: r['checkin_date'] as string,
          time: taipeiTime(r['checked_in_at'] as string),
        })),
        dailyCheckinCampusIds: modes.ids,
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
