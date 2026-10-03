import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { countExamsBySession, sessionExamKey } from '../../lib/session-exams';
import { countEnrolledOn, type EnrollmentRange } from '../../lib/session-roster';
import { isSubstituteSession } from '../../lib/session-substitute';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端讀取「孩子的課堂」—— 課表、首頁今日課、出勤頁共用。
 * 見 kb/wiki/architecture/parent-sessions-read.md。
 *
 * 範圍跟 `class-logs.ts` 同形：`pluck` 這個孩子的 enrollments 拿到 `ScopedIds`，
 * `fromScopedIds` 查 sessions，再用 `countEnrolledOn` 把在籍區間外的堂濾掉（轉班防線）。
 * admin 的 `summariseSessions` 吃原始 `supabase` 且回全班人數，不能複用 —— 只複用純函式。
 */

/** 月曆一頁最多 6 週 */
const MAX_WINDOW_DAYS = 42;

const SESSION_SELECT = `
  id, event_id, session_date, start_time, end_time, status, class_id, teacher_id,
  teacher:staff!teacher_id(display_name),
  schedules!schedule_id(teacher_id, teacher:staff!teacher_id(display_name)),
  classes!inner(name, campuses(name), courses(name)),
  schedule_changes(
    change_type,
    original_session_date, original_start_time, original_end_time,
    new_session_date, new_start_time, new_end_time,
    created_at
  )
`;

const ChangeSchema = z.object({
  changeType: z.enum(['reschedule', 'substitute', 'cancellation']),
  originalDate: z.string().nullable(),
  originalStartTime: z.string().nullable(),
  originalEndTime: z.string().nullable(),
  newDate: z.string().nullable(),
  newStartTime: z.string().nullable(),
  newEndTime: z.string().nullable(),
  // reason / created_by_name 不回：家長端只顯示「代課／改期／停課」標記，不顯示原因與經手人
});

const ParentSessionSchema = z
  .object({
    sessionId: DbUuidSchema,
    date: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    /** 停課的堂照樣回（家長最需要知道的就是「這堂不上了」） */
    status: z.enum(['scheduled', 'completed', 'cancelled']),
    classId: DbUuidSchema,
    className: z.string().nullable(),
    courseName: z.string().nullable(),
    campusName: z.string().nullable(),
    /** 實際上課的老師（代課時是代課老師） */
    teacherName: z.string().nullable(),
    isSubstitute: z.boolean(),
    /** 只有代課時才有值：課表排定的原任課老師 */
    originalTeacherName: z.string().nullable(),
    examCount: z.number().int().min(0),
    changes: z.array(ChangeSchema),
    /** 這個孩子在那堂的出勤；還沒點名（含未來的堂）是 null */
    attendance: z
      .object({
        status: z.enum(['present', 'absent', 'on_leave']),
        checkedInAt: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi('ParentSession');

const ListResponseSchema = z
  .object({ data: z.array(ParentSessionSchema) })
  .openapi('ParentSessionListResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentSessionError');

type Row = Record<string, unknown>;

const one = (value: unknown): Row | null => (Array.isArray(value) ? value[0] : value) as Row | null;
const many = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : value ? [value as Row] : [];
const hhmm = (value: unknown) => (typeof value === 'string' ? value.slice(0, 5) : null);
const nameOf = (value: unknown) => (one(value)?.['display_name'] as string | undefined) ?? null;

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/sessions
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子在日期窗內的課堂',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        dateFrom: z.string().date(),
        dateTo: z.string().date(),
      }),
    },
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ListResponseSchema } } },
      400: {
        description: '日期窗不合法（倒置或超過 42 天）',
        content: { 'application/json': { schema: ErrorSchema } },
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

    const span = daysBetween(dateFrom, dateTo);
    if (span < 0 || span > MAX_WINDOW_DAYS) {
      return c.json(
        { error: `日期區間要在 0～${MAX_WINDOW_DAYS} 天之間`, code: 'INVALID_DATE_RANGE' },
        400,
      );
    }

    const failed = () => c.json({ error: '讀取課堂失敗', code: 'FETCH_SESSIONS_FAILED' }, 500);
    const childDb = c.get('childDb');

    const {
      rows: enrollmentRows,
      ids: classIds,
      error: enrollmentError,
    } = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id, effective_from, effective_to', 'class_id', childId);
    if (enrollmentError) return failed();
    if (classIds.length === 0) return c.json({ data: [] }, 200);

    const ranges: EnrollmentRange[] = enrollmentRows.map((row) => ({
      classId: row['class_id'] as string,
      effectiveFrom: row['effective_from'] as string,
      effectiveTo: (row['effective_to'] as string | null) ?? null,
    }));

    const [sessionResult, examResult, checkinResult] = await Promise.all([
      childDb
        .fromScopedIds('sessions', 'class_id', classIds)
        .select(SESSION_SELECT)
        .gte('session_date', dateFrom)
        .lte('session_date', dateTo),
      childDb
        .fromScopedIds('academy_exam_classes', 'class_id', classIds)
        .select('class_id, academy_exams!inner(exam_date)')
        .gte('academy_exams.exam_date', dateFrom)
        .lte('academy_exams.exam_date', dateTo),
      childDb
        .from('daily_checkins', 'student_id')
        .select('checkin_date, checked_in_at')
        .eq('student_id', childId)
        .gte('checkin_date', dateFrom)
        .lte('checkin_date', dateTo),
    ]);
    if (sessionResult.error || examResult.error || checkinResult.error) return failed();

    // 轉班防線：只用「讀過的班」查到的堂，要再落在那個班的在籍區間內
    const sessions = ((sessionResult.data ?? []) as unknown as Row[])
      .filter(
        (s) => countEnrolledOn(ranges, s['class_id'] as string, s['session_date'] as string) > 0,
      )
      // ponytail: 記憶體排序 —— 窗最多 42 天、一個孩子的堂數是個位到兩位數
      .sort((a, b) =>
        `${a['session_date']} ${a['start_time']}`.localeCompare(
          `${b['session_date']} ${b['start_time']}`,
        ),
      );

    const eventIds = sessions.map((s) => s['event_id'] as string | null).filter((v) => !!v);
    const attendanceResult = eventIds.length
      ? await childDb
          .from('attendance_records', 'student_id')
          .select('event_id, status')
          .eq('student_id', childId)
          .in('event_id', eventIds as string[])
      : { data: [], error: null };
    if (attendanceResult.error) return failed();

    const attendanceByEvent = new Map(
      ((attendanceResult.data ?? []) as unknown as Row[]).map((r) => [r['event_id'], r['status']]),
    );
    const checkinByDate = new Map(
      ((checkinResult.data ?? []) as unknown as Row[]).map((r) => [
        r['checkin_date'],
        r['checked_in_at'] as string,
      ]),
    );
    const examCounts = countExamsBySession(
      ((examResult.data ?? []) as unknown as Row[]).map((r) => ({
        class_id: r['class_id'] as string,
        exam_date: one(r['academy_exams'])?.['exam_date'] as string,
      })),
    );

    const data = sessions.map((s) => {
      const classRow = one(s['classes']);
      const schedule = one(s['schedules']);
      const date = s['session_date'] as string;
      const isSubstitute = isSubstituteSession({
        sessionTeacherId: (s['teacher_id'] as string | null) ?? null,
        scheduleTeacherId: (schedule?.['teacher_id'] as string | null) ?? null,
      });
      const attendanceStatus = attendanceByEvent.get(s['event_id']);

      return {
        sessionId: s['id'] as string,
        date,
        startTime: hhmm(s['start_time']),
        endTime: hhmm(s['end_time']),
        status: s['status'] as 'scheduled' | 'completed' | 'cancelled',
        classId: s['class_id'] as string,
        className: (classRow?.['name'] as string | undefined) ?? null,
        courseName: (one(classRow?.['courses'])?.['name'] as string | undefined) ?? null,
        campusName: (one(classRow?.['campuses'])?.['name'] as string | undefined) ?? null,
        teacherName: nameOf(s['teacher']),
        isSubstitute,
        originalTeacherName: isSubstitute ? nameOf(schedule?.['teacher']) : null,
        examCount: examCounts.get(sessionExamKey(s['class_id'] as string, date)) ?? 0,
        changes: many(s['schedule_changes'])
          .sort((a, b) => String(a['created_at']).localeCompare(String(b['created_at'])))
          .map((ch) => ({
            changeType: ch['change_type'] as 'reschedule' | 'substitute' | 'cancellation',
            originalDate: (ch['original_session_date'] as string | null) ?? null,
            originalStartTime: hhmm(ch['original_start_time']),
            originalEndTime: hhmm(ch['original_end_time']),
            newDate: (ch['new_session_date'] as string | null) ?? null,
            newStartTime: hhmm(ch['new_start_time']),
            newEndTime: hhmm(ch['new_end_time']),
          })),
        attendance: attendanceStatus
          ? {
              status: attendanceStatus as 'present' | 'absent' | 'on_leave',
              checkedInAt: checkinByDate.get(date) ?? null,
            }
          : null,
      };
    });

    return c.json({ data }, 200);
  },
);

export default app;
