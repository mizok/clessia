import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import { resolveTeacherScope } from './attendance/teacher-scope';
import type { AppEnv } from '../index';
import { isAttendanceEditable } from '../lib/attendance-window';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { assertAttendanceWindow } from '../lib/attendance-window-check';
import { sessionSummarySelect, summariseSessions } from '../lib/session-summary';
import { isSubstituteSession } from '../lib/session-substitute';
import { countExamsBySession, sessionExamKey } from '../lib/session-exams';
import { resolveRecordedByRole } from '../lib/recorded-by-role';
import { leaveCoversSession } from '../lib/leave-covers-session';
import { cancelLeaveForDate } from '../lib/cancel-leave-for-date';
import { countEnrolledOn, tallyAttendance, type EnrollmentRange } from '../lib/session-roster';
import { formatAuditSessionResourceName, logAudit } from '../utils/audit';
import { assertTeacherCanWriteAttendance } from '../lib/attendance-write-scope';
import { applyCampusFilter, type CampusScope } from '../lib/campus-scope';
import {
  ATTENDANCE_SELECT,
  flattenAttendanceRow,
  toAttendanceResponse,
} from '../lib/attendance-query';
import { DbUuidSchema } from '../lib/validation';
import { hasSessionEndedByNow } from '../lib/session-end-time';
import { sliceDerivedPage } from '../lib/derived-page';
import {
  applyAttendanceTakenFilter,
  ensureAttendanceSessionEvents,
  type AttendanceSessionStatus,
} from '../lib/attendance-session-events';

const AttendanceStatusSchema = z
  .enum(['present', 'absent', 'on_leave'])
  .openapi('AttendanceStatus');

const AttendanceRecordSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    studentId: DbUuidSchema,
    studentName: z.string(),
    eventId: DbUuidSchema,
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    campusName: z.string().nullable(),
    className: z.string().nullable(),
    status: AttendanceStatusSchema,
    note: z.string().nullable(),
    recordedBy: z.string().nullable(),
    recordedByRole: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AttendanceRecord');

const AttendanceListResponseSchema = z
  .object({
    data: z.array(AttendanceRecordSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('AttendanceListResponse');

const EventSessionSummarySchema = z
  .object({
    /** 課堂本身的 id。**這才是穩定的鍵** —— eventId 可能是 null（見下） */
    sessionId: DbUuidSchema,
    /**
     * 出勤事件的 id。**停課的課堂可能沒有** —— 出勤事件是列表時才補建的，
     * 而停課的課堂刻意不補（不會發生的課不該在行事曆上長出一筆）。
     * 沒有 eventId 就不能點名，前端要據此關掉點名入口。
     */
    eventId: DbUuidSchema.nullable(),
    /** `scheduled` / `completed` / `cancelled` —— 停課要顯示成灰底 */
    status: z.enum(['scheduled', 'completed', 'cancelled']),
    /** 實際上這堂課的老師跟課表排定的不一致 */
    isSubstitute: z.boolean(),
    /**
     * 這個班在這一天排了幾場校內考（`academy_exams`）。0 就是沒有。
     * **刻意只回數量**，不回考試內容 —— 課表格子要的是一個記號，
     * 塞整包考試資料進列表只會把每頁的體積放大而沒人用得到。
     */
    examCount: z.number().int().nonnegative(),
    classId: DbUuidSchema,
    className: z.string(),
    /** 這個班用聯絡簿還是教務日誌 —— 老師端分入口用，`/api/classes` 是 ADMIN_ONLY 拿不到 */
    usesContactBook: z.boolean(),
    courseName: z.string().nullable(),
    teacherName: z.string().nullable(),
    campusId: DbUuidSchema.nullable(),
    campusName: z.string().nullable(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    enrolledCount: z.number(),
    presentCount: z.number(),
    onLeaveCount: z.number(),
    absentCount: z.number(),
    takenAt: z.string().nullable(),
  })
  .openapi('EventSessionSummary');

const AttendanceSessionListResponseSchema = z
  .object({
    data: z.array(EventSessionSummarySchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('AttendanceSessionListResponse');

const RosterStudentSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    grade: z.string().nullable(),
    school: z.string().nullable(),
    recordId: DbUuidSchema.nullable(),
    status: AttendanceStatusSchema.nullable(),
    /**
     * 這個學生今天有一張蓋到這堂課的請假單。
     *
     * **跟 `status === 'on_leave'` 是兩件事**：`status` 是「紀錄上寫了什麼」，
     * 這個是「有沒有請假這件事」。請假連動只寫得到**建立請假當下已經存在的** event，
     * 而出勤事件是懶生成的 —— 先請假、之後才生成的課堂，紀錄上什麼都沒有。
     * 所以這一欄是**讀取時推導**的，不看紀錄。
     *
     * 兩欄都給，是因為「老師明確標了缺席、但這人其實有請假」也要看得出來 ——
     * 用推導的值覆蓋掉 `status` 會把那個資訊蓋掉。
     *
     * ⚠️ **不要拿這一欄去鎖住那一列**（本註解原本寫的是
     * `status === 'on_leave' || hasLeaveRequest` 全鎖，2026-09-02 裁決推翻）：
     * 矛盾態本身就滿足那個 `||`，全鎖會讓老師看到一個他動不了的問題；
     * 而這一欄是推導的，誤判一次就鎖死一格，而銷假出口目前還不存在。
     * 鎖住的條件只有 `status === 'on_leave'`，理由見
     * `attendance-roster-panel.component.ts` 的 `isLocked`。
     */
    hasLeaveRequest: z.boolean(),
    /**
     * 蓋到這堂課的請假**最遠請到哪一天**（沒有假時是 null）。
     *
     * 銷假會把「今天」從假裡拿掉，而**跨日的假會被截斷、後段一併取消**。
     * 前端要在老師按下去**之前**就能說「這一按會連帶取消到 X 日」——
     * 事前確認跟事後告知是兩件事，後者已經來不及了。
     *
     * 起日則是所有蓋到今天的假裡**最早的**開始日。
     *
     * ⚠️ **#185 當時我寫「只回結束日，回起訖等於謊稱它們是同一張」—— 那個顧慮不成立，
     * 現在補上起日。** 理由：這裡的每一張假**都涵蓋今天**，所以它們的聯集必然是
     * 連續的，而且剛好等於 `[min(start), max(end)]` —— 中間不可能有洞。
     * 而且這一組數字要回答的問題不是「這是哪一張假」，是**「按下去會影響哪個區間」**，
     * 那個區間確實就是這一組。
     *
     * 有了起日，前端的事前警告才能從「會取消到 X 日」變成
     * 「會取消 X 到 Y 的請假」—— 老師看得到自己按下去會動到什麼。
     */
    leaveStartDate: z.string().nullable(),
    leaveEndDate: z.string().nullable(),
    /**
     * 按下銷假**會連坐取消到哪一天**；`null` 代表不會損失任何後續日期。
     *
     * **這是預測值，不是聚合值。** `leaveStartDate` / `leaveEndDate` 是跨多張假的
     * min/max，而 min/max **分不出「一張長假」與「兩張接力假」**：
     * `[4/4~4/6] + [4/6~4/8]`（今天 4/6）聚合起來跟 `[4/4~4/8]` 完全同形，
     * 但前者銷假的結果是**兩張各縮一天、零損失**，後者是**後段整段被取消**。
     * 前端拿 min/max 算 `start < today && end > today` 會對接力假誤報
     *（teacher-pages 用測試釘住了這個限制，文案因此只能說「可能」）。
     *
     * 所以這一欄在**伺服器端逐張假算**，而且**直接用銷假自己那支
     * `cancelLeaveForDate`** —— 預測與實際動作共用同一份實作，
     * 不會出現「預覽說會、按下去卻不會」。
     *
     * 為什麼不開一支 dry-run 端點：那會在每次銷假前多一次往返，
     * 而延遲 ≈ 每請求固定成本 × 請求次數（查詢執行只佔 1 毫秒）。
     * 這一欄是既有 roster 回應多一個欄位，**零往返**。
     */
    cancelDropsLeaveUntil: z.string().nullable(),
  })
  .openapi('RosterStudent');

const AttendanceRosterSchema = z
  .object({
    eventId: DbUuidSchema,
    takenAt: z.string().nullable(),
    students: z.array(RosterStudentSchema),
  })
  .openapi('AttendanceRoster');

const BatchAttendanceUpdateSchema = z
  .object({
    eventId: z.string(),
    updates: z
      .array(
        z.object({
          studentId: z.string(),
          /**
           * **`on_leave` 是這裡才開放的** —— 舊版只收 present/absent，老師端沒有
           * 「標成請假」可以點，請假的學生只能被跳過，落進「沒有紀錄」這個洞
           * （P0-2：全班點完名，請假的學生完全不在到／請／缺任何一欄）。
           * 允許送 on_leave 之後，老師端才有辦法明確記下「這個人請假」而不是
           * 讓那一格永遠是 pending。
           */
          status: z.enum(['present', 'absent', 'on_leave']),
        }),
      )
      .min(1),
  })
  .openapi('BatchAttendanceUpdate');

const UpdateAttendanceSchema = z
  .object({
    status: AttendanceStatusSchema.optional(),
    note: z.string().nullable().optional(),
  })
  .openapi('UpdateAttendance');

const CreateAttendanceSchema = z
  .object({
    studentId: DbUuidSchema,
    eventId: DbUuidSchema,
    status: AttendanceStatusSchema,
    note: z.string().nullable().optional(),
  })
  .openapi('CreateAttendance');

interface AttendanceAuditResourceNameInput {
  readonly courseName?: string | null;
  readonly className?: string | null;
  readonly eventDate?: string | null;
  readonly startTime?: string | null;
}

interface AttendanceBatchAuditUpdate {
  readonly studentId: string;
  readonly status: 'present' | 'absent' | 'on_leave';
}

export function buildAttendanceAuditResourceName(
  input: AttendanceAuditResourceNameInput,
): string | null {
  return formatAuditSessionResourceName({
    courseName: input.courseName,
    className: input.className,
    sessionDate: input.eventDate,
    startTime: input.startTime,
  });
}

export function buildAttendanceAuditBatchDetails(
  updates: ReadonlyArray<AttendanceBatchAuditUpdate>,
) {
  return {
    updatedCount: updates.length,
    presentCount: updates.filter((update) => update.status === 'present').length,
    absentCount: updates.filter((update) => update.status === 'absent').length,
    // 少了這一欄，on_leave 的更新會讓 presentCount + absentCount < updatedCount
    // ——正是 P0-2 那個「1+0+1=2 但這班有 3 人」的病灶，這裡不能重演同一個坑。
    onLeaveCount: updates.filter((update) => update.status === 'on_leave').length,
  };
}

export function normalizeAttendanceSessionStatuses(
  statuses: string | undefined,
): AttendanceSessionStatus[] | null {
  if (!statuses) {
    return null;
  }

  const normalized = statuses
    .split(',')
    .map((status) => status.trim())
    .filter(
      (status): status is AttendanceSessionStatus =>
        status === 'scheduled' || status === 'completed' || status === 'cancelled',
    );

  return normalized.length > 0 ? normalized : null;
}

export function normalizeAttendanceFilterIds(filterIds: string | undefined): string[] {
  if (!filterIds) {
    return [];
  }

  return Array.from(
    new Set(
      filterIds
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function buildAttendanceSessionListMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

function extractAttendanceAuditContext(source: Record<string, any> | null | undefined) {
  const event = source?.['events'] ?? source;
  const sessionRows = Array.isArray(event?.sessions)
    ? event.sessions
    : event?.sessions
      ? [event.sessions]
      : [];
  const classRow = sessionRows[0]?.classes;
  const courseRow = Array.isArray(classRow?.courses) ? classRow.courses[0] : classRow?.courses;

  return {
    courseName: (courseRow?.name as string | null | undefined) ?? null,
    className: (classRow?.name as string | null | undefined) ?? null,
    eventDate: (event?.event_date as string | null | undefined) ?? null,
    startTime: (event?.start_time as string | null | undefined)?.slice(0, 5) ?? null,
  };
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/attendance
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Attendance'],
    summary: '查詢出勤紀錄',
    request: {
      query: z.object({
        campusId: DbUuidSchema.optional(),
        studentId: DbUuidSchema.optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        status: AttendanceStatusSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '出勤紀錄列表',
        content: { 'application/json': { schema: AttendanceListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      campusId,
      studentId,
      dateFrom,
      dateTo,
      status,
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

    let query = supabase
      .from('attendance_records')
      .select(ATTENDANCE_SELECT, { count: 'exact' })
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (status) query = query.eq('status', status);
    if (dateFrom) query = query.gte('events.event_date', dateFrom);
    if (dateTo) query = query.lte('events.event_date', dateTo);
    query = applyCampusFilter(query, 'events.campus_id', c.get('campusScope'), campusId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取出勤紀錄失敗', message: error.message }, 500);
    }

    const rows = (data ?? []).map((r: any) => flattenAttendanceRow(r));

    const total = count ?? 0;
    return c.json(
      {
        data: rows.map(toAttendanceResponse),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/attendance
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Attendance'],
    summary: '新增出勤紀錄',
    request: {
      body: { content: { 'application/json': { schema: CreateAttendanceSchema } } },
    },
    responses: {
      201: {
        description: '建立的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const roles = c.get('roles') ?? [];

    const { data: ev } = await supabase
      .from('events')
      .select('event_date')
      .eq('id', body.eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂或無權限', message: undefined }, 500);

    // **範圍：這堂課是不是他的。** 時窗管「什麼時候還能改」，範圍管「能改誰的」，
    // 兩個都要過。清單本來就回傳 eventId，少了這一段，老師換一個值就改得動別班。
    if (
      !(await assertTeacherCanWriteAttendance(supabase, {
        orgId,
        userId,
        roles,
        eventId: body.eventId,
      }))
    ) {
      return c.json({ error: '這不是你的課堂', code: 'FORBIDDEN' }, 403);
    }

    if ((ev as any).event_date > getCurrentTaipeiDateString()) {
      return c.json({ error: '未來課堂尚未開放點名', message: undefined }, 500);
    }

    const window = await assertAttendanceWindow(supabase, {
      orgId,
      roles,
      eventDate: (ev as any).event_date as string,
    });
    if (!window.ok) {
      return c.json({ error: '已超過補登期限，請聯繫管理員', message: undefined }, 500);
    }
    if (window.outOfWindowByAdmin) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'attendance',
          resourceId: body.eventId,
          action: 'retroactive_edit',
          details: { eventDate: (ev as any).event_date as string },
        },
        waitUntilFrom(c),
      );
    }

    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        event_id: body.eventId,
        status: body.status,
        note: body.note ?? null,
        recorded_by: userId,
        recorded_by_role: resolveRecordedByRole(c.get('roles') ?? []),
      })
      .select(
        '*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name), sessions(classes(name, courses(name))))',
      )
      .single();

    if (error || !data) {
      return c.json({ error: '新增出勤紀錄失敗', message: error?.message }, 500);
    }

    const row = {
      ...data,
      student_name: (data as any).students?.name ?? '',
      event_date: (data as any).events?.event_date ?? '',
      start_time: (data as any).events?.start_time ?? null,
      end_time: (data as any).events?.end_time ?? null,
      campus_name: (data as any).events?.campuses?.name ?? null,
      class_name: null,
    };

    const auditContext = extractAttendanceAuditContext(data as Record<string, any>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: body.eventId,
        resourceName: buildAttendanceAuditResourceName(auditContext),
        action: 'create',
        details: {
          studentName: row.student_name,
          status: body.status,
          note: body.note ?? null,
        },
      },
      waitUntilFrom(c),
    );

    return c.json(toAttendanceResponse(row), 201);
  },
);

// PATCH /api/attendance/batch
app.openapi(
  createRoute({
    method: 'patch',
    path: '/batch',
    tags: ['Attendance'],
    summary: '批次儲存點名結果（原子性，同步更新 attendance_taken_at）',
    request: {
      body: { content: { 'application/json': { schema: BatchAttendanceUpdateSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ updated: z.number(), takenAt: z.string() }),
          },
        },
      },
      400: { description: '參數錯誤' },
      403: { description: '無權限' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { eventId, updates } = c.req.valid('json');

    const { data: ev } = await supabase
      .from('events')
      .select(
        'id, attendance_taken_at, event_date, start_time, end_time, sessions(class_id, classes(name, courses(name)))',
      )
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂或無權限' }, 403);

    const roles = c.get('roles') ?? [];

    // **範圍：這堂課是不是他的。** 時窗管「什麼時候還能改」，範圍管「能改誰的」，
    // 兩個都要過。清單本來就回傳 eventId，少了這一段，老師換一個值就改得動別班。
    if (
      !(await assertTeacherCanWriteAttendance(supabase, { orgId, userId, roles, eventId: eventId }))
    ) {
      return c.json({ error: '這不是你的課堂', code: 'FORBIDDEN' }, 403);
    }

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    if (eventDate > getCurrentTaipeiDateString()) {
      return c.json({ error: '未來課堂尚未開放點名' }, 400);
    }

    const window = await assertAttendanceWindow(supabase, {
      orgId,
      roles,
      eventDate: eventDate,
    });
    if (!window.ok) {
      return c.json({ error: '已超過補登期限，請聯繫管理員' }, 403);
    }
    if (window.outOfWindowByAdmin) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'attendance',
          resourceId: eventId,
          action: 'retroactive_edit',
          details: { eventDate: eventDate },
        },
        waitUntilFrom(c),
      );
    }

    const { data: validEnrollments } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', classId)
      .eq('status', 'active')
      .lte('effective_from', eventDate)
      .or(`effective_to.is.null,effective_to.gte.${eventDate}`);

    const validIds = new Set((validEnrollments ?? []).map((e: any) => e.student_id));
    const invalidIds = updates.filter((u) => !validIds.has(u.studentId));
    if (invalidIds.length > 0) {
      return c.json({ error: '部分學生不在此課堂修課名單中' }, 400);
    }

    /**
     * 未被標記、但有生效請假蓋到這堂課的學生 —— **後端補寫 `on_leave`，不是前端算好再送**。
     *
     * P0-2：全班點完名，請假的學生完全不在到／請／缺任何一欄，因為請假連動只寫得到
     * 「建立請假當下已經存在」的 event（懶生成的出勤事件常常還沒生出來），紀錄從此
     * 缺席。裁決是補起這個縫，而不是在前端加一顆「標成請假」硬要老師表態——
     * 判定邏輯留在後端（跟 roster GET 用同一支 `leaveCoversSession`），前端只送
     * 它明確標記過的那些人，這裡補上其餘有請假覆蓋的人。
     *
     * 已知取捨：這樣做之後，「請假的學生其實來了」在點名畫面上**沒有覆寫入口**
     * （`attendance-roster-panel.component.ts` 的 `isLocked` 原本只鎖紀錄，是為了
     * 讓連動有縫時那一列還能標；縫補起來之後鎖是真的鎖住了）。這是刻意的：
     * 學生請假卻出現是例外，例外走既有的銷假流程，比讓每一堂課的點名畫面都多一個
     * 覆寫入口便宜。如果之後真的踩到（老師回報「他來了改不了」），那是回頭談的
     * 正當理由，不是這裡漏想。
     */
    const markedIds = new Set(updates.map((u) => u.studentId));
    const unmarkedIds = [...validIds].filter((id) => !markedIds.has(id));

    let inferredLeaveRecords: Array<{
      org_id: string;
      event_id: string;
      student_id: string;
      status: 'on_leave';
      recorded_by: string;
      recorded_by_role: 'system';
    }> = [];

    if (unmarkedIds.length > 0) {
      const { data: leaves } = await supabase
        .from('leave_requests')
        .select('student_id, start_date, end_date, start_time, end_time')
        .eq('org_id', orgId)
        .in('student_id', unmarkedIds)
        .lte('start_date', eventDate)
        .gte('end_date', eventDate);

      const sessionWindow = {
        date: eventDate,
        startTime: (ev as any).start_time ?? null,
        endTime: (ev as any).end_time ?? null,
      };

      const coveredStudentIds = new Set<string>();
      for (const leave of (leaves ?? []) as Array<Record<string, unknown>>) {
        const studentId = leave['student_id'] as string;
        if (coveredStudentIds.has(studentId)) continue; // 一個學生只要有一張蓋到就夠了
        const covers = leaveCoversSession(
          {
            startDate: leave['start_date'] as string,
            endDate: leave['end_date'] as string,
            startTime: (leave['start_time'] as string | null) ?? null,
            endTime: (leave['end_time'] as string | null) ?? null,
          },
          sessionWindow,
        );
        if (covers) coveredStudentIds.add(studentId);
      }

      inferredLeaveRecords = [...coveredStudentIds].map((studentId) => ({
        org_id: orgId,
        event_id: eventId,
        student_id: studentId,
        status: 'on_leave' as const,
        recorded_by: userId,
        recorded_by_role: 'system' as const,
      }));
    }

    const records = [
      ...updates.map((u) => ({
        org_id: orgId,
        event_id: eventId,
        student_id: u.studentId,
        status: u.status,
        recorded_by: userId,
        recorded_by_role: resolveRecordedByRole(c.get('roles') ?? []),
      })),
      ...inferredLeaveRecords,
    ];

    const { error: upsertError } = await supabase
      .from('attendance_records')
      .upsert(records, { onConflict: 'event_id,student_id' });

    if (upsertError) {
      return c.json({ error: '儲存出勤失敗', message: upsertError.message }, 500);
    }

    const takenAt = (ev as any).attendance_taken_at ?? new Date().toISOString();

    if (!(ev as any).attendance_taken_at) {
      await supabase
        .from('events')
        .update({ attendance_taken_at: takenAt })
        .eq('id', eventId)
        .eq('org_id', orgId);
    }

    const auditContext = extractAttendanceAuditContext(ev as Record<string, any>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: eventId,
        resourceName: buildAttendanceAuditResourceName(auditContext),
        action: 'batch_update_attendance',
        // 教師明確標記的算一組，後端依請假單補寫的另外記一個數字 ——
        // 兩者混在一起會讓稽核看不出「這堂課有幾個人是系統推的，不是他標的」
        details: {
          ...buildAttendanceAuditBatchDetails(updates),
          inferredLeaveCount: inferredLeaveRecords.length,
        },
      },
      waitUntilFrom(c),
    );

    // `records.length` 不是 `updates.length` —— 補寫的請假紀錄也是真的寫進去的筆數，
    // 少算等於告訴老師「存了 2 筆」但資料庫其實動了 3 筆。
    return c.json({ updated: records.length, takenAt }, 200);
  },
);

// PATCH /api/attendance/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Attendance'],
    summary: '修改出勤狀態',
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateAttendanceSchema } } },
    },
    responses: {
      200: {
        description: '更新後的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const roles = c.get('roles') ?? [];

    const { data: existing } = await supabase
      .from('attendance_records')
      .select('event_id, events(event_date)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: '找不到出勤紀錄或無權限', message: undefined }, 500);

    // **範圍：這堂課是不是他的。** 時窗管「什麼時候還能改」，範圍管「能改誰的」，
    // 兩個都要過。清單本來就回傳 eventId，少了這一段，老師換一個值就改得動別班。
    if (
      !(await assertTeacherCanWriteAttendance(supabase, {
        orgId,
        userId,
        roles,
        eventId: (existing as any).event_id as string,
      }))
    ) {
      return c.json({ error: '這不是你的課堂', code: 'FORBIDDEN' }, 403);
    }

    const existingEventDate = (existing as any).events?.event_date as string | null;
    if (existingEventDate && existingEventDate > getCurrentTaipeiDateString()) {
      return c.json({ error: '未來課堂尚未開放點名', message: undefined }, 500);
    }

    if (existingEventDate) {
      const window = await assertAttendanceWindow(supabase, {
        orgId,
        roles,
        eventDate: existingEventDate,
      });
      if (!window.ok) {
        return c.json({ error: '已超過補登期限，請聯繫管理員', message: undefined }, 500);
      }
      if (window.outOfWindowByAdmin) {
        logAudit(
          supabase,
          {
            orgId,
            userId,
            resourceType: 'attendance',
            resourceId: id,
            action: 'retroactive_edit',
            details: { eventDate: existingEventDate },
          },
          waitUntilFrom(c),
        );
      }
    }

    const updates: Record<string, unknown> = {
      recorded_by: userId,
      recorded_by_role: resolveRecordedByRole(c.get('roles') ?? []),
    };
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.note !== undefined) updates['note'] = body.note;

    const { data, error } = await supabase
      .from('attendance_records')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select(
        '*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name), sessions(classes(name, courses(name))))',
      )
      .single();

    if (error || !data) {
      return c.json({ error: '更新出勤紀錄失敗', message: error?.message }, 500);
    }

    const row = {
      ...data,
      student_name: (data as any).students?.name ?? '',
      event_date: (data as any).events?.event_date ?? '',
      start_time: (data as any).events?.start_time ?? null,
      end_time: (data as any).events?.end_time ?? null,
      campus_name: (data as any).events?.campuses?.name ?? null,
      class_name: null,
    };

    const auditContext = extractAttendanceAuditContext(data as Record<string, any>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: row.event_id,
        resourceName: buildAttendanceAuditResourceName(auditContext),
        action: 'update',
        details: {
          studentName: row.student_name,
          status: row.status,
          note: row.note,
        },
      },
      waitUntilFrom(c),
    );

    return c.json(toAttendanceResponse(row), 200);
  },
);

/**
 * `endedOnly` 撈候選集合時的上限（見下方 route 的說明）。單一 org、一段查詢
 * 區間下，這個數字留了遠超「未點名課堂」卡片實際量級（近 7 天、一天數十堂）
 * 的餘裕。**真的頂到這個上限時，該做的是把呼叫端的日期區間縮小，不是調高它**
 * ——調高只會把同一個問題往後推，縮小區間才是治本。
 */
const ENDED_ONLY_CANDIDATE_LIMIT = 1000;

// GET /api/attendance/sessions
app.openapi(
  createRoute({
    method: 'get',
    path: '/sessions',
    tags: ['Attendance'],
    summary: '取得課堂出勤摘要列表（by 日期）',
    request: {
      query: z.object({
        date: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        campusId: DbUuidSchema.optional(),
        courseIds: z.string().optional(),
        classIds: z.string().optional(),
        statuses: z.string().optional(),
        /**
         * 有沒有點名過。**跟 `statuses` 不是同一件事** —— 後者是課堂狀態
         *（scheduled / completed / cancelled），這個是「出勤點了沒」。
         *
         * `false` 是儀表板「未點名課堂」那張卡要的：搭 `pageSize=1` 取 `meta.total`，
         * 數字由伺服器算。**在此之前前端是撈前 100 筆自己數**，一天 15 堂的補習班
         * 回看 7 天就 105 堂 —— 破 100 之後悄悄少算，而且錯得沒有徵兆。
         */
        attendanceTaken: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => (value === undefined ? undefined : value === 'true')),
        /**
         * 只回「已經上完」的課堂——`hasSessionEndedByNow()` 的語意搬到這裡，
         * 是儀表板「未點名課堂」卡片原本被迫拆成兩段查的補齊（`dateFrom=7天前 ~
         * dateTo=今天` + `attendanceTaken=false` + `endedOnly=true` 一次查完，
         * 不必再讓前端對 `workbench/today` 的明細逐筆濾）。
         *
         * 配這個參數時**不走 DB 分頁**——「上完了沒」是推導值，DB 濾不掉，
         * 跟 `invoices.ts` 的 `overdue`/`status` 同一個形狀：撈候選集合、
         * 應用層過濾、`sliceDerivedPage` 切頁。候選集合有 `.limit()` 上限，
         * 見下方實作。
         */
        endedOnly: z
          .enum(['true'])
          .optional()
          .transform((value) => value === 'true'),
        // 只有管理員說了算：老師一律被蓋成自己（見 attendance/teacher-scope.ts）
        teacherId: DbUuidSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '課堂出勤摘要',
        content: { 'application/json': { schema: AttendanceSessionListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      date,
      dateFrom,
      dateTo,
      campusId,
      courseIds,
      classIds,
      statuses,
      attendanceTaken,
      endedOnly,
      teacherId,
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

    const dateFromValue = date ?? dateFrom;
    const dateToValue = date ?? dateTo;

    const roles = c.get('roles') ?? [];

    // 管理員不受老師範圍限制，所以不必查 staff —— 這支 route 每次請求都會跑
    let ownStaffId: string | null = null;
    if (!roles.includes('admin')) {
      const { data: ownStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('user_id', c.get('userId'))
        .eq('org_id', orgId)
        .maybeSingle();
      ownStaffId = (ownStaff?.id as string | undefined) ?? null;
    }

    const scope = resolveTeacherScope({ roles, requested: teacherId, ownStaffId });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const courseIdList = normalizeAttendanceFilterIds(courseIds);
    const classIdList = normalizeAttendanceFilterIds(classIds);
    const statusList = normalizeAttendanceSessionStatuses(statuses) ?? ['scheduled', 'completed'];
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    // **停課的課堂不補建出勤事件。** 出勤事件是「這堂課要點名」的載體，而停課的課
    // 不會發生 —— 補建的話行事曆與出勤相關的視圖會多出一筆不存在的課。
    // 代價是這些課堂的 `eventId` 是 null，回應 schema 明著標成 nullable。
    const ensureStatusList = statusList.filter((status) => status !== 'cancelled');
    if (ensureStatusList.length > 0) {
      const ensureEventsResult = await ensureAttendanceSessionEvents({
        supabase,
        orgId,
        campusScope: c.get('campusScope'),
        campusId,
        courseIdList,
        classIdList,
        statusList: ensureStatusList,
        dateFromValue,
        dateToValue,
      });
      if (ensureEventsResult.error) {
        return c.json({ error: '補齊課堂事件失敗', message: ensureEventsResult.error }, 500);
      }
    }

    let sessionsQuery = supabase
      .from('sessions')
      // 「有沒有點名」的條件下在 embed 的欄位上，**必須配 inner join**，
      // 否則它會靜靜地什麼都不篩（實測見 lib/session-summary.ts 的表）
      .select(sessionSummarySelect({ requireEvent: attendanceTaken !== undefined }), {
        count: 'exact',
      })
      .eq('org_id', orgId)
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true });

    // `endedOnly` 是推導條件（「上完了沒」DB 濾不掉），跟 invoices.ts 的
    // `overdue`/`status` 同一個形狀：不走 DB `.range()`，改撈一個候選集合、
    // 應用層過濾、`sliceDerivedPage` 切頁。候選集合設一個上限而不是無界撈——
    // 這支端點的呼叫情境是「單一 org、一段查詢區間」，`ENDED_ONLY_CANDIDATE_LIMIT`
    // 留了遠超實際量級的餘裕；真的頂到上限時該做的是縮小查詢區間，不是調高上限。
    sessionsQuery = endedOnly
      ? sessionsQuery.limit(ENDED_ONLY_CANDIDATE_LIMIT)
      : sessionsQuery.range(fromIndex, toIndex);

    if (dateFromValue) {
      sessionsQuery = sessionsQuery.gte('session_date', dateFromValue);
      sessionsQuery = sessionsQuery.lte('session_date', dateToValue ?? dateFromValue);
    }

    sessionsQuery = applyCampusFilter(
      sessionsQuery,
      'classes.campus_id',
      c.get('campusScope'),
      campusId,
    );
    if (courseIdList.length > 0) {
      sessionsQuery = sessionsQuery.in('classes.course_id', courseIdList);
    }
    if (classIdList.length > 0) {
      sessionsQuery = sessionsQuery.in('class_id', classIdList);
    }
    if (scope.teacherId) sessionsQuery = sessionsQuery.eq('teacher_id', scope.teacherId);
    sessionsQuery = sessionsQuery.in('status', statusList);

    sessionsQuery = applyAttendanceTakenFilter(sessionsQuery, attendanceTaken);

    const { data: sessions, error: sessionsError, count } = await sessionsQuery;
    if (sessionsError)
      return c.json({ error: '查詢課堂失敗', message: sessionsError.message }, 500);

    const results = await summariseSessions(supabase, orgId, sessions);

    if (endedOnly) {
      const ended = results.filter((session) =>
        hasSessionEndedByNow({
          date: session.eventDate,
          startTime: session.startTime,
          endTime: session.endTime,
        }),
      );
      const { rows, total } = sliceDerivedPage(ended, page, pageSize);
      return c.json(
        { data: rows, meta: buildAttendanceSessionListMeta(total, page, pageSize) },
        200,
      );
    }

    return c.json(
      {
        data: results,
        meta: buildAttendanceSessionListMeta(count ?? 0, page, pageSize),
      },
      200,
    );
  },
);

// GET /api/attendance/roster/:eventId
app.openapi(
  createRoute({
    method: 'get',
    path: '/roster/{eventId}',
    tags: ['Attendance'],
    summary: '取得課堂點名名單（懶建立，不寫 DB）',
    request: {
      params: z.object({ eventId: z.string() }),
    },
    responses: {
      200: {
        description: '課堂點名名單',
        content: { 'application/json': { schema: AttendanceRosterSchema } },
      },
      404: { description: '找不到資源' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { eventId } = c.req.valid('param');

    const { data: ev, error: evError } = await supabase
      .from('events')
      .select('id, event_date, start_time, end_time, attendance_taken_at, sessions(class_id)')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (evError || !ev) return c.json({ error: '找不到課堂' }, 404);

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('student_id, students(name, grade, schools(id, name, short_name))')
      .eq('class_id', classId)
      .eq('status', 'active')
      .lte('effective_from', eventDate)
      .or(`effective_to.is.null,effective_to.gte.${eventDate}`);

    const { data: records } = await supabase
      .from('attendance_records')
      .select('id, student_id, status')
      .eq('event_id', eventId)
      .eq('org_id', orgId);

    const recordMap = new Map(
      (records ?? []).map((r: any) => [r.student_id, { id: r.id, status: r.status }]),
    );

    // 這一天蓋到這堂課的請假單。**推導不查紀錄** —— 理由見 RosterStudentSchema
    // 的 `hasLeaveRequest`：請假連動寫不到「請假之後才生成」的 event。
    const rosterStudentIds = (enrollments ?? []).map((e: any) => e.student_id as string);
    const { data: leaves } =
      rosterStudentIds.length === 0
        ? { data: [] as Array<Record<string, unknown>> }
        : await supabase
            .from('leave_requests')
            .select('student_id, start_date, end_date, start_time, end_time')
            .eq('org_id', orgId)
            .in('student_id', rosterStudentIds)
            .lte('start_date', eventDate)
            .gte('end_date', eventDate);

    const sessionWindow = {
      date: eventDate,
      startTime: ((ev as any).start_time as string | null) ?? null,
      endTime: ((ev as any).end_time as string | null) ?? null,
    };
    // 每個學生記「被影響的區間」—— 同一天可能被兩張假蓋到，銷假會把兩張都動到，
    // 所以警告要涵蓋最早的起日到最晚的迄日。
    // **每一張都涵蓋今天，所以聯集必然連續**，這一組數字是精確的不是包絡。
    const leaveStartByStudent = new Map<string, string>();
    const leaveEndByStudent = new Map<string, string>();
    // 銷假的連坐預測 —— 逐張假算，不是從 min/max 推（見 schema 的說明）
    const cancelDropsByStudent = new Map<string, string>();
    for (const row of (leaves ?? []) as Array<Record<string, unknown>>) {
      const covers = leaveCoversSession(
        {
          startDate: row['start_date'] as string,
          endDate: row['end_date'] as string,
          startTime: (row['start_time'] as string | null) ?? null,
          endTime: (row['end_time'] as string | null) ?? null,
        },
        sessionWindow,
      );
      if (!covers) continue;

      const studentKey = row['student_id'] as string;
      const startDate = row['start_date'] as string;
      const endDate = row['end_date'] as string;

      const existingStart = leaveStartByStudent.get(studentKey);
      if (!existingStart || startDate < existingStart) {
        leaveStartByStudent.set(studentKey, startDate);
      }

      const existingEnd = leaveEndByStudent.get(studentKey);
      if (!existingEnd || endDate > existingEnd) leaveEndByStudent.set(studentKey, endDate);

      // **用銷假自己那支算**：預測與動作共用一份實作，才不會「預覽說會、按下去卻不會」
      const action = cancelLeaveForDate({ startDate, endDate }, eventDate);
      if (action.kind === 'shrink' && action.droppedAfter) {
        const existingDrop = cancelDropsByStudent.get(studentKey);
        // 多張都連坐時取最遠的那一天 —— 警告要說出最壞的情況
        if (!existingDrop || action.droppedAfter > existingDrop) {
          cancelDropsByStudent.set(studentKey, action.droppedAfter);
        }
      }
    }

    const students = (enrollments ?? []).map((e: any) => {
      const rec = recordMap.get(e.student_id);
      return {
        studentId: e.student_id,
        studentName: e.students?.name ?? '',
        grade: e.students?.grade ?? null,
        school: e.students?.schools?.short_name ?? e.students?.schools?.name ?? null,
        recordId: rec?.id ?? null,
        status: rec?.status ?? null,
        hasLeaveRequest: leaveEndByStudent.has(e.student_id),
        leaveStartDate: leaveStartByStudent.get(e.student_id) ?? null,
        leaveEndDate: leaveEndByStudent.get(e.student_id) ?? null,
        cancelDropsLeaveUntil: cancelDropsByStudent.get(e.student_id) ?? null,
      };
    });

    return c.json(
      {
        eventId,
        takenAt: (ev as any).attendance_taken_at ?? null,
        students,
      },
      200,
    );
  },
);

// POST /api/attendance/roster/:eventId/cancel-leave
//
// **銷假：請假的學生今天出現了。**
//
// 業務決定（2026-09-03 使用者定案）：**銷假就是刪掉請假單，不留痕作廢** ——
// 沒有「已取消」狀態。稽核紀錄是我們的底線，被刪掉的內容進 audit log 的 details，
// 那不算「留痕作廢」（使用者看不到，是我們查事情用的）。
//
// **放在 /api/attendance 底下而不是 /api/leaves**：後者掛 ADMIN_ONLY，而且那支
// DELETE 帶著 `mode=truncate|full` 的語意 —— 老師站在點名 dialog 前面不該去理解它。
// 用 eventId 進來，班級（範圍檢查）、日期、學生一次到齊。
const CancelLeaveResponseSchema = z
  .object({
    /** 整張刪掉的請假單數 */
    leavesDeleted: z.number().int().nonnegative(),
    /** 縮短範圍（而不是刪掉）的請假單數 —— 跨日的假只拿掉這一天 */
    leavesTruncated: z.number().int().nonnegative(),
    /** 一併清掉的 on_leave 出勤紀錄數 */
    attendanceRecordsRemoved: z.number().int().nonnegative(),
    /**
     * 今天卡在請假區間中間時，後段被連坐取消到哪一天。
     * **前端要把這件事告訴老師**（「後續日期的請假也一併取消，如需請假請重新申請」）——
     * 這是「截斷而不是切成兩張」這個選擇的代價，不能默默吃掉。
     */
    droppedAfter: z.string().nullable(),
  })
  .openapi('CancelLeaveResponse');

app.openapi(
  createRoute({
    method: 'post',
    path: '/roster/{eventId}/cancel-leave',
    tags: ['Attendance'],
    summary: '銷假（請假的學生今天出現了）',
    request: {
      params: z.object({ eventId: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ studentId: z.string() }) } } },
    },
    responses: {
      200: {
        description: '已銷假',
        content: { 'application/json': { schema: CancelLeaveResponseSchema } },
      },
      403: { description: '無權限' },
      404: { description: '找不到課堂，或這個學生當天沒有假' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { eventId } = c.req.valid('param');
    const { studentId } = c.req.valid('json');

    // 範圍：跟點名同一條規則（含代課 —— 代課老師當天就是要點那堂課的名）
    const allowed = await assertTeacherCanWriteAttendance(supabase, {
      orgId,
      userId: c.get('userId'),
      roles: c.get('roles') ?? [],
      eventId,
    });
    if (!allowed) return c.json({ error: '無權限操作此課堂' }, 403);

    const { data: ev } = await supabase
      .from('events')
      .select('id, event_date')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂' }, 404);

    const eventDate = (ev as { event_date: string }).event_date;

    // 老師只能銷「今天」的假 —— 銷假的依據是「他人就在我面前」，那只有當天成立。
    // 管理員不受限（他在處理事後的更正）。
    const isAdmin = (c.get('roles') ?? []).includes('admin');
    if (!isAdmin && eventDate !== getCurrentTaipeiDateString()) {
      return c.json({ error: '只能銷當天的假' }, 403);
    }

    const { data: leaves } = await supabase
      .from('leave_requests')
      .select('id, start_date, end_date, start_time, end_time, reason, submitted_by_role')
      .eq('org_id', orgId)
      .eq('student_id', studentId)
      .lte('start_date', eventDate)
      .gte('end_date', eventDate);

    const leaveRows = (leaves ?? []) as Array<Record<string, unknown>>;
    if (leaveRows.length === 0) {
      return c.json({ error: '這個學生當天沒有請假' }, 404);
    }

    let leavesDeleted = 0;
    let leavesTruncated = 0;
    let droppedAfter: string | null = null;

    for (const row of leaveRows) {
      const action = cancelLeaveForDate(
        { startDate: row['start_date'] as string, endDate: row['end_date'] as string },
        eventDate,
      );

      if (action.kind === 'delete') {
        await supabase
          .from('leave_requests')
          .delete()
          .eq('id', row['id'] as string);
        leavesDeleted += 1;
      } else if (action.kind === 'shrink') {
        await supabase
          .from('leave_requests')
          .update({ start_date: action.startDate, end_date: action.endDate })
          .eq('id', row['id'] as string);
        leavesTruncated += 1;
        // **取最遠的，不是最後一個** —— 多張假都連坐時，「最後處理到的那張」
        // 取決於查詢回傳順序，那不是一個有意義的答案。
        // roster 的 `cancelDropsLeaveUntil` 用同一條規則，兩邊才對得起來。
        if (action.droppedAfter && (!droppedAfter || action.droppedAfter > droppedAfter)) {
          droppedAfter = action.droppedAfter;
        }
      }
    }

    // **當天所有課堂的 on_leave 紀錄一起清掉，而且是刪除不是改成 absent。**
    //
    // 刪除：老師銷假是因為學生就站在他面前，寫 absent 等於系統替他寫一個相反的謊。
    // 「回到可標記狀態」的意思就是**沒有紀錄**（沒有紀錄 ≠ 缺席）。
    //
    // 當天全部：假已經不蓋到今天了，其他課堂還留著 on_leave 會變成
    // 「有紀錄說請假、但沒有假」的矛盾態。
    const { data: dayEvents } = await supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .eq('event_date', eventDate);

    const dayEventIds = ((dayEvents ?? []) as Array<{ id: string }>).map((row) => row.id);

    let attendanceRecordsRemoved = 0;
    if (dayEventIds.length > 0) {
      const { data: removed } = await supabase
        .from('attendance_records')
        .delete()
        .eq('org_id', orgId)
        .eq('student_id', studentId)
        .eq('status', 'on_leave')
        .in('event_id', dayEventIds)
        .select('id');

      attendanceRecordsRemoved = ((removed ?? []) as unknown[]).length;
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'leave',
        resourceId: eventId,
        resourceName: null,
        action: 'cancel_leave',
        details: {
          studentId,
          eventDate,
          leavesDeleted,
          leavesTruncated,
          droppedAfter,
          attendanceRecordsRemoved,
          // **被刪掉的內容留在這裡。** 使用者選了「不留痕作廢」，但稽核是我們的底線 ——
          // 沒有這一段，事後沒有任何辦法知道那張假原本是什麼。
          removedLeaves: leaveRows,
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ leavesDeleted, leavesTruncated, attendanceRecordsRemoved, droppedAfter }, 200);
  },
);

export default app;
