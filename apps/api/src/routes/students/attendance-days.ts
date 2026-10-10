import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import { pickAttendanceMode } from '../../lib/attendance-mode';
import { getCampusScope } from '../../lib/campus-scope';
import {
  LEAVE_WINDOW_COLUMNS,
  leaveCoversSession,
  toLeaveWindow,
  type LeaveWindow,
} from '../../lib/leave-covers-session';
import { findInOrg } from '../../lib/org-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';
import { outOfCampusScope, teacherCannotRead } from './read-scope';

/**
 * 學生檔案的「到班格」（#1314 SD2）：區間內**他有課的每一天一格**。
 *
 * | 格子 | 判定（優先序） |
 * | --- | --- |
 * | `cancelled` | 當天他的課全停 |
 * | `future` | 日期在今天之後；或今天、最早那堂還沒開始 |
 * | `came` | 日到班分校：當天有打卡；逐堂分校：任一堂出勤 present（系統沒有遲到格） |
 * | `on_leave` | 假單蓋到當天任一堂 |
 * | `absent` | 其餘 |
 *
 * **模式依班的分校逐天判**，不用作業台那種單一 mode —— 同一個學生可能跨兩種模式的分校。
 * 日到班分校**以打卡為準、不看出勤紀錄**（A6「掃一次碼＝當天的課都算出席」；計畫席 10-10 記可否決）。
 *
 * 母體：他的報名（排除作廢）所屬班的課，**只取報名生效區間涵蓋的那天** —— 退班前的課照算、之後的不算。
 * 查詢支數固定（授權 1～3、報名、課、機構與分校模式、打卡、出勤、請假），不隨天數成長。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

const DayStateSchema = z.enum(['came', 'absent', 'on_leave', 'cancelled', 'future']);

const AttendanceDaysSchema = z
  .object({
    days: z.array(
      z.object({
        date: z.string(),
        state: DayStateSchema,
        sessions: z.array(
          z.object({
            sessionId: z.string(),
            className: z.string(),
            startTime: z.string().nullable(),
            status: z.string(),
          }),
        ),
      }),
    ),
    summary: z.object({
      /** 該到的天數（非停課、非未來）—— A6「到班 x／y 天」的 y */
      due: z.number(),
      came: z.number(),
      absentDates: z.array(z.string()),
    }),
    /** 今天有他的課（非停課）→ 最早那堂開始時間 */
    today: z.object({ startTime: z.string().nullable() }).nullable(),
    /** 區間內今天之後的第一堂（非停課）。區間外的不找 */
    nextSession: z
      .object({ date: z.string(), startTime: z.string().nullable(), className: z.string() })
      .nullable(),
  })
  .openapi('StudentAttendanceDays');

const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() });

type Row = Record<string, unknown>;

interface DaySession {
  sessionId: string;
  eventId: string | null;
  classId: string;
  className: string;
  campusId: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
}

const app = new OpenAPIHono<AppEnv>();

app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/attendance-days',
    tags: ['Students'],
    summary: '學生檔案的到班格：區間內每個上課日一格',
    request: {
      params: z.object({ id: DbUuidSchema }),
      query: z.object({
        from: z.string().regex(DATE),
        to: z.string().regex(DATE),
      }),
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: AttendanceDaysSchema } } },
      400: { description: '區間不合法', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '學生不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');

    if (to < from || addDaysToDateString(from, MAX_DAYS) <= to) {
      return c.json(
        { error: `區間要 from ≤ to 且不超過 ${MAX_DAYS} 天`, code: 'INVALID_RANGE' },
        400,
      );
    }

    // 授權跟 `GET /students/{id}` 同一套（read-scope.ts）：org → 分校範圍（#1394）→ 老師只看任課學生（#1098）
    if (
      !(await findInOrg(supabase, 'students', orgId, id)) ||
      (await outOfCampusScope(supabase, orgId, id, getCampusScope(c)))
    ) {
      return c.json({ error: '學生不存在' }, 404);
    }
    if (await teacherCannotRead(supabase, orgId, c.get('userId'), c.get('roles') ?? [], id)) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const fail = (message: string) => c.json({ error: '查詢到班紀錄失敗', message }, 500);

    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('class_id, effective_from, effective_to')
      .eq('org_id', orgId)
      .eq('student_id', id)
      .neq('status', 'void');
    if (enrollmentError) return fail(enrollmentError.message);

    const enrollments = (enrollmentRows ?? []) as Array<{
      class_id: string;
      effective_from: string;
      effective_to: string | null;
    }>;
    const covered = (classId: string, date: string) =>
      enrollments.some(
        (e) =>
          e.class_id === classId &&
          e.effective_from <= date &&
          (e.effective_to === null || e.effective_to >= date),
      );
    const classIds = [...new Set(enrollments.map((e) => e.class_id))];

    // ponytail: 一次撈完區間內的課，上限 1000 列（≈ 366 天 × 每週 2～3 堂 × 6～7 個班）；超過就明講，不默默截斷
    const { data: sessionRows, error: sessionError } =
      classIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('sessions')
            .select(
              'id, event_id, class_id, session_date, start_time, end_time, status, events!event_id(start_time, end_time, campus_id), classes!inner(name, campus_id)',
            )
            .eq('org_id', orgId)
            .in('class_id', classIds)
            .gte('session_date', from)
            .lte('session_date', to)
            .order('session_date')
            .order('start_time')
            .limit(1000);
    if (sessionError) return fail(sessionError.message);
    if ((sessionRows ?? []).length >= 1000) return fail('區間內的課超過 1000 堂，請縮短區間');

    const sessions: DaySession[] = ((sessionRows ?? []) as Row[])
      .map((row) => {
        const event = row['events'] as Row | null;
        const cls = row['classes'] as Row | null;
        const start = (event?.['start_time'] ?? row['start_time']) as string | null;
        const end = (event?.['end_time'] ?? row['end_time']) as string | null;
        return {
          sessionId: row['id'] as string,
          eventId: (row['event_id'] as string | null) ?? null,
          classId: row['class_id'] as string,
          className: (cls?.['name'] as string | undefined) ?? '',
          campusId: ((event?.['campus_id'] ?? cls?.['campus_id']) as string | null) ?? null,
          date: row['session_date'] as string,
          startTime: start?.slice(0, 5) ?? null,
          endTime: end?.slice(0, 5) ?? null,
          status: row['status'] as string,
        };
      })
      .filter((session) => covered(session.classId, session.date));

    const campusIds = [...new Set(sessions.flatMap((s) => (s.campusId ? [s.campusId] : [])))];
    const eventIds = sessions.flatMap((s) => (s.eventId ? [s.eventId] : []));

    const [org, campuses, checkins, records, leaves] = await Promise.all([
      supabase.from('organizations').select('attendance_mode').eq('id', orgId).maybeSingle(),
      campusIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('campuses')
            .select('id, attendance_mode')
            .eq('org_id', orgId)
            .in('id', campusIds),
      supabase
        .from('daily_checkins')
        .select('checkin_date')
        .eq('org_id', orgId)
        .eq('student_id', id)
        .gte('checkin_date', from)
        .lte('checkin_date', to),
      eventIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from('attendance_records')
            .select('event_id, status')
            .eq('org_id', orgId)
            .eq('student_id', id)
            .in('event_id', eventIds),
      supabase
        .from('leave_requests')
        .select(LEAVE_WINDOW_COLUMNS)
        .eq('org_id', orgId)
        .eq('student_id', id)
        .lte('start_date', to)
        .gte('end_date', from),
    ]);
    const queryError = [org, campuses, checkins, records, leaves].find((r) => r.error)?.error;
    if (queryError) return fail(queryError.message);

    const orgMode = (org.data as { attendance_mode?: string } | null)?.attendance_mode;
    const modeByCampus = new Map(
      ((campuses.data ?? []) as Array<{ id: string; attendance_mode: string | null }>).map(
        (row) => [row.id, pickAttendanceMode(row.attendance_mode, orgMode)],
      ),
    );
    const modeOf = (campusId: string | null) =>
      (campusId && modeByCampus.get(campusId)) || pickAttendanceMode(null, orgMode);
    const checkinDates = new Set(
      ((checkins.data ?? []) as Array<{ checkin_date: string }>).map((row) => row.checkin_date),
    );
    // 系統沒有遲到格（只有 present／absent／on_leave）；舊資料若有 late 也算到
    const presentEvents = new Set(
      ((records.data ?? []) as Array<{ event_id: string; status: string }>)
        .filter((row) => row.status === 'present' || row.status === 'late')
        .map((row) => row.event_id),
    );
    const leaveWindows: LeaveWindow[] = ((leaves.data ?? []) as Row[]).map(toLeaveWindow);

    const today = getCurrentTaipeiDateString();
    const now = Date.now();
    const started = (s: DaySession) =>
      s.startTime !== null && new Date(`${s.date}T${s.startTime}:00+08:00`).getTime() <= now;

    const byDate = new Map<string, DaySession[]>();
    for (const session of sessions) {
      byDate.set(session.date, [...(byDate.get(session.date) ?? []), session]);
    }

    const days = [...byDate].map(([date, list]) => {
      const held = list.filter((s) => s.status !== 'cancelled');
      const state = ((): z.infer<typeof DayStateSchema> => {
        if (held.length === 0) return 'cancelled';
        if (date > today || (date === today && !held.some(started))) return 'future';
        const came = held.some((s) =>
          modeOf(s.campusId) === 'daily_checkin'
            ? checkinDates.has(date)
            : s.eventId !== null && presentEvents.has(s.eventId),
        );
        if (came) return 'came';
        const onLeave = held.some((s) =>
          leaveWindows.some((leave) =>
            leaveCoversSession(leave, {
              sessionId: s.sessionId,
              date,
              startTime: s.startTime,
              endTime: s.endTime,
            }),
          ),
        );
        return onLeave ? 'on_leave' : 'absent';
      })();
      return {
        date,
        state,
        sessions: list.map((s) => ({
          sessionId: s.sessionId,
          className: s.className,
          startTime: s.startTime,
          status: s.status,
        })),
      };
    });

    const due = days.filter((d) => d.state !== 'cancelled' && d.state !== 'future');
    const heldToday = (byDate.get(today) ?? []).filter((s) => s.status !== 'cancelled');
    const next = sessions.find((s) => s.date > today && s.status !== 'cancelled');

    return c.json(
      {
        days,
        summary: {
          due: due.length,
          came: due.filter((d) => d.state === 'came').length,
          absentDates: due.filter((d) => d.state === 'absent').map((d) => d.date),
        },
        today: heldToday.length > 0 ? { startTime: heldToday[0]!.startTime } : null,
        nextSession: next
          ? { date: next.date, startTime: next.startTime, className: next.className }
          : null,
      },
      200,
    );
  },
);

export default app;
