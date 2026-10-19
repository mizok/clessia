import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isCancelledSession } from '../../lib/cancelled-session';
import { isChildAllowed } from '../../lib/child-scope';
import { buildLeaveAttendanceUpserts, getLeaveValidationError } from '../../lib/leave-attendance';
import {
  LEAVE_WINDOW_COLUMNS,
  leaveCoversSession,
  leavesConflict,
  toLeaveWindow,
  type LeaveWindow,
} from '../../lib/leave-covers-session';
import { DbUuidSchema } from '../../lib/validation';
import { waitUntilFrom } from '../../lib/wait-until';

/**
 * 家長幫孩子請假（#1695，設計稿 kb/wiki/specs/parent/leave.md）。
 *
 * **判準跟管理端共用，讀寫各走各的**（計畫席 10-17 (A)）：「這張假蓋到哪幾堂、要寫哪些 `on_leave`」
 * 用 `lib/leave-attendance.ts`；這裡一律走 `childDb`（A19，拿不到原始 client）：
 * 課堂照 `parent/sessions.ts` 的寫法（`pluck` 孩子的 enrollments → `fromScopedIds('sessions')`），
 * 寫入用 scoped 的 `insert`／`upsert`，通知老師用 `childDb.notifyLeave` 這個窄能力。
 *
 * - **送出即生效**，沒有核准；**可以補請**（已經開始或上完的課也能請，Q1 12:48 更正）
 * - 區間內這個孩子一堂課都沒有 → 400 `NO_SESSIONS`，不建單（Q4）
 * - 跟已有的假重疊 → 409（判準同管理端 `leavesConflict`）
 * - 不勾堂次（Q6），不寫 `leave_request_sessions`
 */

const isParent = (roles: readonly string[] | undefined) => (roles ?? []).includes('parent');
const notParent = { error: '不是家長身分', code: 'NOT_PARENT' } as const;
const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() });

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable()
  .optional();

const CreateParentLeaveSchema = z.object({
  studentId: DbUuidSchema,
  startDate: DateSchema,
  endDate: DateSchema,
  startTime: TimeSchema,
  endTime: TimeSchema,
  reason: z.string().max(500).nullable().optional(),
});

const ParentLeaveSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  reason: z.string().nullable(),
});

const SESSION_SELECT =
  'id, class_id, status, session_date, start_time, end_time, event_id, events!event_id(event_date, start_time, end_time)';

type Row = Record<string, unknown>;

const app = new OpenAPIHono<AppEnv>();

app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Parent'],
    summary: '家長幫孩子請假（送出即生效，範圍內的課改成請假）',
    request: { body: { content: { 'application/json': { schema: CreateParentLeaveSchema } } } },
    responses: {
      201: {
        description: '建立的請假',
        content: { 'application/json': { schema: z.object({ data: ParentLeaveSchema }) } },
      },
      400: {
        description: '日期無效／這段時間沒有課（NO_SESSIONS）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '不是家長、或不是自己的孩子',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '跟已有的請假重疊',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!isParent(c.get('roles'))) return c.json(notParent, 403);
    const body = c.req.valid('json');
    const childDb = c.get('childDb');
    const userId = c.get('userId');
    const orgId = c.get('orgId');
    const studentId = body.studentId;
    const failed = () => c.json({ error: '送出請假失敗', code: 'SERVER_ERROR' }, 500);

    if (!isChildAllowed(c.get('studentScope'), studentId)) {
      return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    }

    const validationError = getLeaveValidationError(body);
    if (validationError) return c.json({ error: validationError, code: 'INVALID_LEAVE' }, 400);

    const window: LeaveWindow = {
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      boundSessions: [],
    };

    // 1. 這段時間孩子有報名、沒停課、被這張假蓋到的堂（跟管理端 applyLeaveAttendance 同一組在籍判準：status = active）
    const enrolled = await childDb
      .from('enrollments', 'student_id')
      .pluck('class_id, effective_from, effective_to, status', 'class_id', studentId);
    if (enrolled.error) return failed();
    const enrollments = enrolled.rows
      .filter((row) => row['status'] === 'active')
      .map((row) => ({
        class_id: row['class_id'] as string,
        effective_from: row['effective_from'] as string,
        effective_to: (row['effective_to'] as string | null) ?? null,
      }));
    const enrolledOn = (classId: string, date: string) =>
      enrollments.some(
        (e) =>
          e.class_id === classId &&
          e.effective_from <= date &&
          (e.effective_to === null || e.effective_to >= date),
      );

    const sessionResult =
      enrolled.ids.length === 0
        ? { data: [], error: null }
        : await childDb
            .fromScopedIds('sessions', 'class_id', enrolled.ids)
            .select(SESSION_SELECT)
            .gte('session_date', window.startDate)
            .lte('session_date', window.endDate);
    if (sessionResult.error) return failed();

    const covered = ((sessionResult.data ?? []) as unknown as Row[]).filter((s) => {
      const event = s['events'] as Row | null;
      const date = s['session_date'] as string;
      return (
        !isCancelledSession(s as never) &&
        enrolledOn(s['class_id'] as string, date) &&
        leaveCoversSession(window, {
          sessionId: s['id'] as string,
          date,
          startTime: ((event?.['start_time'] ?? s['start_time']) as string | null) ?? null,
          endTime: ((event?.['end_time'] ?? s['end_time']) as string | null) ?? null,
        })
      );
    });
    if (covered.length === 0) {
      return c.json({ error: '這段時間沒有課', code: 'NO_SESSIONS' }, 400);
    }

    // 2. 重疊（判準同管理端）
    const existing = await childDb
      .from('leave_requests', 'student_id')
      .select(`id, ${LEAVE_WINDOW_COLUMNS}`)
      .eq('student_id', studentId)
      .lte('start_date', window.endDate)
      .gte('end_date', window.startDate);
    if (existing.error) return failed();
    if (
      ((existing.data ?? []) as unknown as Row[]).some((row) =>
        leavesConflict(toLeaveWindow(row), window),
      )
    ) {
      return c.json({ error: '這段時間已經請過假了', code: 'LEAVE_OVERLAP' }, 409);
    }

    // 3. 寫入（scoped insert；org_id 由 childDb 蓋）
    const inserted = await childDb.from('leave_requests', 'student_id').insert(
      {
        student_id: studentId,
        start_date: window.startDate,
        end_date: window.endDate,
        start_time: window.startTime,
        end_time: window.endTime,
        reason: body.reason ?? null,
        submitted_by: userId,
        submitted_by_role: 'parent',
      },
      'id, student_id, start_date, end_date, start_time, end_time, reason',
    );
    if (inserted.outOfScope) return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    const leave = inserted.data as Row | null;
    if (inserted.error || !leave) return failed();

    // 4. 有 event 的堂寫成 on_leave（沒 event 的堂是懶生成，讀取時由 leaveCoversSession 推導，同管理端）
    const upserts = buildLeaveAttendanceUpserts({
      orgId,
      studentId,
      recordedBy: userId,
      events: covered
        .filter((s) => s['event_id'])
        .map((s) => ({
          id: s['event_id'] as string,
          event_date: s['session_date'] as string,
          sessions: {
            id: s['id'] as string,
            class_id: s['class_id'] as string,
            status: s['status'] as string,
          },
        })),
      enrollments,
    });
    if (upserts.length > 0) {
      await childDb.from('attendance_records', 'student_id').upsert(upserts, 'student_id,event_id');
    }

    // 5. 稽核（計畫席 10-17）：補請把缺席改成請假、沒有人核對，事後要查得到改了幾堂、幾堂是補請。
    //    「開始時間已過」用台北時間比（session 的日期與時間都是台北的牆上時間）
    const startedAt = (s: Row) => {
      const event = s['events'] as Row | null;
      const start = ((event?.['start_time'] ?? s['start_time']) as string | null) ?? '00:00';
      return Date.parse(`${s['session_date'] as string}T${start.slice(0, 5)}:00+08:00`);
    };
    const now = Date.now();
    const wu = waitUntilFrom(c);
    await childDb.recordLeave(
      leave['id'] as string,
      {
        sessionCount: covered.length,
        retroactiveSessionCount: covered.filter((s) => startedAt(s) <= now).length,
      },
      userId,
      wu,
    );

    // 6. 通知老師（背景，失敗不擋）。管理員的 leave_received 等 migration（#1695 第 2 張）；
    //    #1732 的連續請假偵測也掛在這裡之後（kb/wiki/specs/admin/finance/leave-streak-waiver.md §3）
    const job = childDb.notifyLeave(
      leave['id'] as string,
      covered.map((s) => s['id'] as string),
      userId,
    );
    if (wu) wu(job);
    else await job;

    const time = (t: unknown) => (typeof t === 'string' ? t.slice(0, 5) : null);
    return c.json(
      {
        data: {
          id: leave['id'] as string,
          studentId,
          startDate: leave['start_date'] as string,
          endDate: leave['end_date'] as string,
          startTime: time(leave['start_time']),
          endTime: time(leave['end_time']),
          reason: (leave['reason'] as string | null) ?? null,
        },
      },
      201,
    );
  },
);

export default app;
