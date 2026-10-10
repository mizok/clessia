import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  isCancelledSession,
  toSessionRows,
  type CancellableSession,
} from '../lib/cancelled-session';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { studentWriteScope } from '../lib/campus-write-guard';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
import { inOrg } from '../lib/org-scope';
import {
  LEAVE_SESSIONS_EMBED,
  LEAVE_WINDOW_COLUMNS,
  leaveCoversSession,
  leavesConflict,
  toLeaveWindow,
  type LeaveWindow,
} from '../lib/leave-covers-session';
import { isEnrolledOn } from '../lib/session-roster';

const LeaveRequestSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    studentId: DbUuidSchema,
    studentName: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    reason: z.string().nullable(),
    submittedBy: z.string(),
    submittedByRole: z.enum(['parent', 'admin']),
    submittedByName: z.string().nullable(),
    createdAt: z.string(),
    /** 勾選綁定的堂次（#1114）；空陣列＝沒綁定，整天／單日時間窗 */
    sessionIds: z.array(z.string()),
  })
  .openapi('LeaveRequest');

const LeaveListResponseSchema = z
  .object({
    data: z.array(LeaveRequestSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('LeaveListResponse');

const CreateLeaveSchema = z
  .object({
    studentId: DbUuidSchema,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    reason: z.string().nullable().optional(),
    /**
     * 勾選要請假的堂次（#1114）。給了就只蓋這幾堂，`startDate`／`endDate` 由 server 從堂次算，
     * 不能跟 `startTime`／`endTime` 同時給。
     */
    sessionIds: z.array(DbUuidSchema).min(1).max(100).optional(),
  })
  .openapi('CreateLeave');

// PATCH 的每個欄位都是 optional —— 沒帶的欄位維持原值。
// **`studentId` 刻意不在這裡**：換學生等於把假從 A 身上撤掉再開給 B，
// 出勤要對兩個學生各做一次反向操作，跟「編輯這張假」不是同一件事。
// 要換人請刪掉重開，那條路徑已經是精準的。
const UpdateLeaveSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    reason: z.string().nullable().optional(),
    /** 給了就整組替換綁定（#1114）；綁定型的假改日期只能走這裡 */
    sessionIds: z.array(DbUuidSchema).min(1).max(100).optional(),
  })
  .openapi('UpdateLeave');

function toHHmm(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.slice(0, 5); // "HH:MM:SS" → "HH:MM"
}

interface LeaveValidationInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
}

interface LeaveAttendanceSessionRow extends CancellableSession {
  readonly class_id: string;
}

interface LeaveAttendanceEventRow {
  readonly id: string;
  readonly event_date: string;
  readonly sessions: LeaveAttendanceSessionRow | LeaveAttendanceSessionRow[] | null;
}

interface LeaveAttendanceEnrollmentRow {
  readonly class_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

interface BuildLeaveAttendanceUpsertsInput {
  readonly orgId: string;
  readonly studentId: string;
  readonly recordedBy: string;
  readonly events: ReadonlyArray<LeaveAttendanceEventRow>;
  readonly enrollments: ReadonlyArray<LeaveAttendanceEnrollmentRow>;
}

interface LeaveAuditResourceNameInput {
  readonly studentName?: string | null;
  readonly startDate: string;
  readonly endDate: string;
}

export function buildLeaveAuditResourceName(input: LeaveAuditResourceNameInput): string {
  return `${input.studentName?.trim() || '請假紀錄'} / ${input.startDate} ~ ${input.endDate}`;
}

export function buildLeaveAttendanceAuditDetails(removedRecordCount: number) {
  // 欄位名維持 `affectedEventCount` —— 既有的 audit_logs 資料用的是這個鍵，
  // 改名會讓舊紀錄跟新紀錄對不起來。**值的意思變了**：現在是真的刪掉幾筆紀錄，
  // 而不是「區間裡有幾個 event」（後者跟這個學生根本無關）。
  return { affectedEventCount: removedRecordCount };
}

export function getLeaveValidationError(input: LeaveValidationInput): string | null {
  if (input.endDate < input.startDate) {
    return '結束日期不可早於開始日期';
  }

  if (
    input.startDate === input.endDate &&
    input.startTime &&
    input.endTime &&
    input.endTime < input.startTime
  ) {
    return '同一天請假的結束時間不可早於開始時間';
  }

  return null;
}

export function buildLeaveAttendanceUpserts(input: BuildLeaveAttendanceUpsertsInput) {
  return input.events
    .filter((eventRow) =>
      input.enrollments.some((enrollment) => {
        const sessionRows = toSessionRows(eventRow.sessions);

        return sessionRows.some(
          (sessionRow) =>
            enrollment.class_id === sessionRow.class_id &&
            !isCancelledSession(sessionRow) &&
            enrollment.effective_from <= eventRow.event_date &&
            (!enrollment.effective_to || enrollment.effective_to >= eventRow.event_date),
        );
      }),
    )
    .map((eventRow) => ({
      org_id: input.orgId,
      student_id: input.studentId,
      event_id: eventRow.id,
      status: 'on_leave' as const,
      recorded_by: input.recordedBy,
      recorded_by_role: 'system',
    }));
}

export interface LeaveDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * 舊區間 → 新區間，哪幾段要撤銷、哪幾段要新寫。
 *
 * **編輯不是「整段重做」** —— 整段撤銷再整段寫回去的話，中間沒有變動的日子會先被
 * 刪掉 `on_leave` 再補回來，而那個「刪」只碰得到還沒點名的課堂、「補」卻會覆蓋
 * 已點名的，於是同一天的紀錄會在一次編輯裡換一個作者。只動真的變了的那幾天，
 * 沒動到的日子就完全不被觸碰。
 *
 * 純字串算術（`addDaysToDateString` 走 `Date.UTC`），**不取「現在」** ——
 * 這裡算的是兩個已知日期之間的關係，跟今天是哪一天無關。
 */
export function diffLeaveDateRanges(
  previous: LeaveDateRange,
  next: LeaveDateRange,
): { removed: LeaveDateRange[]; added: LeaveDateRange[] } {
  // 完全不重疊（含「只差一天的相鄰」）：舊的整段撤銷、新的整段寫入
  if (next.endDate < previous.startDate || next.startDate > previous.endDate) {
    return { removed: [previous], added: [next] };
  }

  const removed: LeaveDateRange[] = [];
  const added: LeaveDateRange[] = [];

  if (next.startDate > previous.startDate) {
    removed.push({
      startDate: previous.startDate,
      endDate: addDaysToDateString(next.startDate, -1),
    });
  }
  if (next.endDate < previous.endDate) {
    removed.push({ startDate: addDaysToDateString(next.endDate, 1), endDate: previous.endDate });
  }
  if (next.startDate < previous.startDate) {
    added.push({ startDate: next.startDate, endDate: addDaysToDateString(previous.startDate, -1) });
  }
  if (next.endDate > previous.endDate) {
    added.push({ startDate: addDaysToDateString(previous.endDate, 1), endDate: next.endDate });
  }

  return { removed, added };
}

interface LeaveAttendanceRangeInput {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly studentId: string;
  readonly from: string;
  readonly to: string;
  /** 只動這張假蓋得到的堂（`leaveCoversSession`） */
  readonly window: LeaveWindow;
}

function coversEvent(window: LeaveWindow, ev: Record<string, any>): boolean {
  return leaveCoversSession(window, {
    sessionId: toSessionRows(ev['sessions'] as { id: string } | null)[0]?.id ?? null,
    date: ev['event_date'] as string,
    startTime: (ev['start_time'] as string | null) ?? null,
    endTime: (ev['end_time'] as string | null) ?? null,
  });
}

/** 只蓋指定堂次的視窗 —— 編輯綁定時，新增／拿掉的那幾堂各自當成一張假去 apply／revert */
function boundWindow(sessions: LeaveWindow['boundSessions']): LeaveWindow {
  const dates = sessions.map((b) => b.date).sort();
  return {
    startDate: dates[0] ?? '',
    endDate: dates[dates.length - 1] ?? '',
    startTime: null,
    endTime: null,
    boundSessions: sessions,
  };
}

type ResolvedSessions =
  | { ok: true; sessions: Array<{ sessionId: string; date: string }> }
  | { ok: false; sessionId: string; message: string };

/**
 * 驗勾選的堂次（#1114）：屬於本 org（c1）、不是停課、學生那天在籍。任一不合就指名那一堂。
 * 在籍的判準跟 `applyLeaveAttendance` 同一組（`status = active` ＋ 生效區間）。
 */
async function resolveBoundSessions(
  supabase: SupabaseClient,
  orgId: string,
  studentId: string,
  sessionIds: readonly string[],
): Promise<ResolvedSessions> {
  const ids = [...new Set(sessionIds)];
  const { data } = await supabase
    .from('sessions')
    .select('id, session_date, class_id, status')
    .eq('org_id', orgId)
    .in('id', ids);
  const byId = new Map(((data ?? []) as Array<Record<string, any>>).map((r) => [r['id'], r]));

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('class_id, effective_from, effective_to')
    .eq('org_id', orgId)
    .eq('student_id', studentId)
    .eq('status', 'active');
  const ranges = (enrollments ?? []) as LeaveAttendanceEnrollmentRow[];

  const sessions: Array<{ sessionId: string; date: string }> = [];
  for (const sessionId of ids) {
    const row = byId.get(sessionId);
    if (!row) return { ok: false, sessionId, message: '找不到這堂課' };
    if (isCancelledSession(row)) return { ok: false, sessionId, message: '這堂課已停課' };
    const date = row['session_date'] as string;
    const enrolled = ranges.some(
      (e) =>
        e.class_id === row['class_id'] &&
        isEnrolledOn({ effectiveFrom: e.effective_from, effectiveTo: e.effective_to }, date),
    );
    if (!enrolled) return { ok: false, sessionId, message: '學生那天不在這個班' };
    sessions.push({ sessionId, date });
  }
  return { ok: true, sessions };
}

/** 跟這個學生既有的假有沒有重疊（`leavesConflict`）；`excludeId` 給編輯排除自己 */
async function findConflictingLeave(
  supabase: SupabaseClient,
  orgId: string,
  studentId: string,
  next: LeaveWindow,
  excludeId?: string,
): Promise<{ start_date: string; end_date: string } | null> {
  let query = supabase
    .from('leave_requests')
    .select(`id, ${LEAVE_WINDOW_COLUMNS}`)
    .eq('org_id', orgId)
    .eq('student_id', studentId);
  if (excludeId) query = query.neq('id', excludeId);
  // 區間有交集是「可能重疊」的必要條件（綁定型的區間＝綁定堂的最早／最晚），再用判準細分
  const { data } = await query.lte('start_date', next.endDate).gte('end_date', next.startDate);
  const hit = ((data ?? []) as Array<Record<string, unknown>>).find((row) =>
    leavesConflict(toLeaveWindow(row), next),
  );
  return (hit as { start_date: string; end_date: string } | undefined) ?? null;
}

/**
 * 把 `[from, to]` 內、該學生實際有報名的課堂寫成 `on_leave`，回傳真的寫了幾筆。
 *
 * **刻意不濾 `attendance_taken_at`**：補請假覆蓋既有紀錄是業務規則允許的
 * （請假也是人工判斷，只是不同的人 —— 見 `kb/wiki/rules/attendance-rules.md`
 * 第 6 節與 #145）。跟下面 `revertLeaveAttendance` 的不對稱是刻意的：
 * **新增一張假是新的人工判斷，撤銷一張假不該回頭改寫別人已經做完的事。**
 *
 * 建立請假與編輯後「新增的日子」共用這一支 —— 兩條路徑各寫一份的話，
 * 「哪些課堂算數」的規則會在兩個地方各自漂移。
 */
async function applyLeaveAttendance(
  input: LeaveAttendanceRangeInput & { readonly recordedBy: string },
): Promise<number> {
  const { supabase, orgId, studentId, recordedBy, from, to } = input;

  const { data: rawEvents } = await supabase
    .from('events')
    // `status` 是給 `isCancelledSession` 排除停課用的 —— 少撈它不會報錯，
    // 只會讓那道過濾靜靜地什麼都不做。理由見 `lib/cancelled-session.ts`。
    .select('id, event_date, start_time, end_time, sessions!inner(id, class_id, status)')
    .eq('org_id', orgId)
    .eq('event_type', 'session')
    .gte('event_date', from)
    .lte('event_date', to);

  // 這張假蓋不蓋得到那堂 —— 跟 roster 推導同一支判斷（綁定堂次、單日時間窗）。
  // #1114 之前這裡完全不看時間：roster 說只蓋下午那堂，紀錄卻把整天都寫成請假。
  const events = ((rawEvents ?? []) as Array<Record<string, any>>).filter((ev) =>
    coversEvent(input.window, ev),
  );
  if (events.length === 0) return 0;

  const classIds = Array.from(
    new Set(
      (events as LeaveAttendanceEventRow[])
        .flatMap((eventRow) =>
          Array.isArray(eventRow.sessions)
            ? eventRow.sessions.map((sessionRow) => sessionRow.class_id)
            : eventRow.sessions?.class_id
              ? [eventRow.sessions.class_id]
              : [],
        )
        .filter((classId): classId is string => !!classId),
    ),
  );

  const { data: enrollments } =
    classIds.length === 0
      ? { data: [] }
      : await supabase
          .from('enrollments')
          .select('class_id, effective_from, effective_to')
          .eq('org_id', orgId)
          .eq('student_id', studentId)
          .eq('status', 'active')
          .in('class_id', classIds)
          .lte('effective_from', to)
          .or(`effective_to.is.null,effective_to.gte.${from}`);

  const attendanceUpserts = buildLeaveAttendanceUpserts({
    orgId,
    studentId,
    recordedBy,
    events: (events ?? []) as LeaveAttendanceEventRow[],
    enrollments: (enrollments ?? []) as LeaveAttendanceEnrollmentRow[],
  });

  if (attendanceUpserts.length === 0) return 0;

  await supabase
    .from('attendance_records')
    .upsert(attendanceUpserts, { onConflict: 'student_id,event_id' });

  return attendanceUpserts.length;
}

/**
 * 把 `[from, to]` 內因為這張假而寫下的 `on_leave` 紀錄**刪掉**，
 * 讓那幾天回到「還沒點名」。回傳真的刪掉幾筆。
 *
 * **原本是改成 `absent`，那是錯的**：管理員撤掉一段假，那幾天的學生就全被記成缺席，
 * 而根本沒有人點過那些名。「沒有紀錄」與「缺席」是兩件事（見 #145、#169）——
 * 系統不該替沒發生過的判斷寫一個答案。
 *
 * **已經點過名的日子維持不動**（`attendance_taken_at` 不是 null）：
 * 那天有人真的看過名單、做過判斷，`on_leave` 是那個判斷的一部分。
 *
 * 刪除請假與編輯後「被砍掉的日子」共用這一支。
 */
async function revertLeaveAttendance(input: LeaveAttendanceRangeInput): Promise<number> {
  const { supabase, orgId, studentId, from, to } = input;

  const { data: rawEvents } = await supabase
    .from('events')
    .select('id, event_date, start_time, end_time, sessions(id)')
    .eq('org_id', orgId)
    .is('attendance_taken_at', null)
    .gte('event_date', from)
    .lte('event_date', to);

  // 跟 apply 對稱：只回這張假蓋得到的堂。綁定型不能把同日別堂（別張假寫的）on_leave 一起帶走
  const events = ((rawEvents ?? []) as Array<Record<string, any>>).filter((ev) =>
    coversEvent(input.window, ev),
  );
  if (events.length === 0) return 0;

  const { data: removed } = await inOrg(
    supabase.from('attendance_records').delete().eq('student_id', studentId),
    orgId,
  )
    .eq('status', 'on_leave')
    .in(
      'event_id',
      events.map((e) => e['id'] as string),
    )
    .select('id');

  // 回傳**真的刪掉幾筆**，不是「區間裡有幾個 event」——
  // 後者本來就跟這個學生無關，寫進稽核只會誤導
  return ((removed ?? []) as unknown[]).length;
}

export function toLeaveResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    startDate: row['start_date'] as string,
    endDate: row['end_date'] as string,
    startTime: toHHmm(row['start_time'] as string | null),
    endTime: toHHmm(row['end_time'] as string | null),
    reason: (row['reason'] as string | null) ?? null,
    submittedBy: row['submitted_by'] as string,
    submittedByRole: row['submitted_by_role'] as 'parent' | 'admin',
    submittedByName: (row['submitted_by_name'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    sessionIds: toLeaveWindow(row).boundSessions.map((b) => b.sessionId),
  };
}

/**
 * PATCH 給了 `sessionIds`：整組替換綁定（#1114）。
 *
 * 原本就是綁定型 → **以堂次做 diff**：拿掉的堂 revert、新增的堂 apply，沒變的堂完全不碰
 * （跟 `diffLeaveDateRanges` 同一個理由：整段重做會讓已點名那堂的紀錄在一次編輯裡換作者）。
 * 原本是整天型 → 舊的整張 revert、新的綁定 apply（語意整個換掉，沒有可以保留的交集）。
 */
async function updateBoundSessions(
  c: Context<AppEnv>,
  input: {
    id: string;
    studentId: string;
    studentName: string;
    prevWindow: LeaveWindow;
    sessionIds: readonly string[];
    hasTime: boolean;
    reason: string | null | undefined;
  },
) {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id, studentId, prevWindow } = input;

  if (input.hasTime) {
    return c.json({ error: '請假資料無效', message: '勾選堂次的假不能再帶時間窗' }, 400);
  }
  const resolved = await resolveBoundSessions(supabase, orgId, studentId, input.sessionIds);
  if (!resolved.ok) {
    return c.json(
      {
        error: '請假資料無效',
        code: 'INVALID_SESSION',
        message: resolved.message,
        sessionId: resolved.sessionId,
      },
      400,
    );
  }
  const nextWindow = boundWindow(resolved.sessions);

  const overlap = await findConflictingLeave(supabase, orgId, studentId, nextWindow, id);
  if (overlap) {
    return c.json(
      {
        error: '請假時間重疊',
        message: `該學生在 ${overlap.start_date} ~ ${overlap.end_date} 已有請假紀錄`,
      },
      409,
    );
  }

  const { data: updated, error: updateError } = await inOrg(
    supabase
      .from('leave_requests')
      .update({
        start_date: nextWindow.startDate,
        end_date: nextWindow.endDate,
        start_time: null,
        end_time: null,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      })
      .eq('id', id),
    orgId,
  )
    .select('*, students(name), ba_user!submitted_by(name)')
    .single();
  if (updateError || !updated) {
    return c.json({ error: '更新請假失敗', message: updateError?.message }, 500);
  }

  const prevBound = prevWindow.boundSessions.length > 0;
  const prevIds = new Set(prevWindow.boundSessions.map((b) => b.sessionId));
  const nextIds = new Set(nextWindow.boundSessions.map((b) => b.sessionId));
  const removed = prevWindow.boundSessions.filter((b) => !nextIds.has(b.sessionId));
  const added = nextWindow.boundSessions.filter((b) => !prevIds.has(b.sessionId));

  if (removed.length > 0) {
    await inOrg(
      supabase
        .from('leave_request_sessions')
        .delete()
        .eq('leave_request_id', id)
        .in(
          'session_id',
          removed.map((b) => b.sessionId),
        ),
      orgId,
    );
  }
  if (added.length > 0) {
    await supabase
      .from('leave_request_sessions')
      .insert(added.map((b) => ({ leave_request_id: id, session_id: b.sessionId, org_id: orgId })));
  }

  const revertWindow = prevBound ? boundWindow(removed) : prevWindow;
  const applyWindow = prevBound ? boundWindow(added) : nextWindow;
  const revertedCount =
    !prevBound || removed.length > 0
      ? await revertLeaveAttendance({
          supabase,
          orgId,
          studentId,
          from: revertWindow.startDate,
          to: revertWindow.endDate,
          window: revertWindow,
        })
      : 0;
  const syncedCount =
    applyWindow.boundSessions.length > 0
      ? await applyLeaveAttendance({
          supabase,
          orgId,
          studentId,
          recordedBy: userId,
          from: applyWindow.startDate,
          to: applyWindow.endDate,
          window: applyWindow,
        })
      : 0;

  const resourceName = buildLeaveAuditResourceName({
    studentName: input.studentName,
    startDate: nextWindow.startDate,
    endDate: nextWindow.endDate,
  });
  for (const [action, count] of [
    ['revert_leave_attendance', revertedCount],
    ['sync_leave_to_attendance', syncedCount],
  ] as const) {
    if (count === 0) continue;
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: id,
        resourceName,
        action,
        details: buildLeaveAttendanceAuditDetails(count),
      },
      waitUntilFrom(c),
    );
  }
  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'leave',
      resourceId: id,
      resourceName,
      action: 'update',
      details: {
        before: { ...prevWindow, boundSessions: undefined, sessionIds: [...prevIds] },
        after: {
          startDate: nextWindow.startDate,
          endDate: nextWindow.endDate,
          sessionIds: [...nextIds],
        },
      },
    },
    waitUntilFrom(c),
  );

  const row = {
    ...updated,
    student_name: (updated as any).students?.name ?? input.studentName,
    submitted_by_name: (updated as any).ba_user?.name ?? null,
    leave_request_sessions: nextWindow.boundSessions.map((b) => ({
      session_id: b.sessionId,
      sessions: { session_date: b.date },
    })),
  };
  return c.json(toLeaveResponse(row), 200);
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/leaves
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Leaves'],
    summary: '查詢請假紀錄',
    request: {
      query: z.object({
        campusId: DbUuidSchema.optional(),
        studentId: DbUuidSchema.optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        coverDate: z.string().optional(),
        /**
         * 還沒結束的假（`end_date >= endFrom`）。管理端「待處理」分頁＝傳台北今天。
         * 跟 `dateFrom`／`dateTo` 不同 —— 那兩個比的是起日／迄日各自一端，不是「跟某天有交集」。
         */
        endFrom: z.string().optional(),
        /** 排序：預設最近建立的在前；`start_asc`／`start_desc` 依開始日（管理端分章用） */
        order: z
          .enum(['created_desc', 'start_asc', 'start_desc'])
          .default('created_desc')
          .optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '請假紀錄列表',
        content: { 'application/json': { schema: LeaveListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      // `campusId` 在 schema 裡宣告了，但**連解構都沒有** —— 它從來沒被用過
      campusId,
      studentId,
      dateFrom,
      dateTo,
      coverDate,
      endFrom,
      order = 'created_desc',
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

    let query = supabase
      .from('leave_requests')
      .select(`*, ${LEAVE_SESSIONS_EMBED}, students!inner(name), ba_user!submitted_by(name)`, {
        count: 'exact',
      })
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (dateFrom) query = query.gte('start_date', dateFrom);
    if (dateTo) query = query.lte('end_date', dateTo);
    if (endFrom) query = query.gte('end_date', endFrom);
    // coverDate: 找出請假範圍包含指定日期的紀錄（start_date <= date AND end_date >= date）
    if (coverDate) {
      query = query.lte('start_date', coverDate).gte('end_date', coverDate);
    }

    // **這支端點本來就收 `campusId`，但從來沒有拿它過濾** —— 前端傳了也沒有效果，
    // 而且沒有任何錯誤，是靜默無效的參數。接分校範圍時一併修掉。
    const campusIds = campusFilterIds(getCampusScope(c), campusId);
    if (campusIds) {
      const { data: campusEnrollments } = await supabase
        .from('enrollments')
        .select('student_id, classes!inner(campus_id)')
        .eq('org_id', orgId)
        .in('classes.campus_id', [...campusIds]);

      const campusStudentIds = Array.from(
        new Set(
          ((campusEnrollments ?? []) as Array<{ student_id: string | null }>)
            .map((row) => row.student_id)
            .filter((id): id is string => !!id),
        ),
      );

      // 這些分校一個學生都沒有 → 回空，不是不加條件（不加就變成看到全部）
      if (campusStudentIds.length === 0) {
        return c.json({ data: [], meta: { total: 0, page, pageSize, totalPages: 0 } }, 200);
      }

      query = query.in('student_id', campusStudentIds);
    }

    const from = (page - 1) * pageSize;
    // 依開始日排序時再以建立時間、id 收斂：同一天開始的假要有固定次序，不然翻頁會重複或漏掉
    query = query.range(from, from + pageSize - 1);
    if (order === 'created_desc') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query
        .order('start_date', { ascending: order === 'start_asc' })
        .order('created_at', { ascending: false })
        .order('id');
    }

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取請假紀錄失敗', message: error.message }, 500);
    }

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      student_name: r.students?.name ?? '',
      submitted_by_name: r.ba_user?.name ?? null,
    }));

    const total = count ?? 0;
    return c.json(
      {
        data: rows.map(toLeaveResponse),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/leaves
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Leaves'],
    summary: '新增請假（即生效，自動更新出勤狀態）',
    request: {
      body: { content: { 'application/json': { schema: CreateLeaveSchema } } },
    },
    responses: {
      201: {
        description: '建立的請假紀錄',
        content: { 'application/json': { schema: LeaveRequestSchema } },
      },
      400: { description: '參數錯誤' },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (body.sessionIds && (body.startTime || body.endTime)) {
      return c.json({ error: '請假資料無效', message: '勾選堂次的假不能再帶時間窗' }, 400);
    }

    const validationError = body.sessionIds ? null : getLeaveValidationError(body);
    if (validationError) {
      return c.json({ error: '請假資料無效', message: validationError }, 400);
    }

    // 分校範圍（#966）：body 只帶 studentId，全域守衛看不到分校。請假會連動出勤（扣堂上游）
    const scoped = await studentWriteScope(supabase, orgId, getCampusScope(c), body.studentId);
    if (scoped === 'not-found') {
      return c.json({ error: '學生不存在', code: 'NOT_FOUND' }, 404);
    }
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    // 0. 勾選堂次（#1114）：驗 org／停課／在籍，區間由堂次算出、不吃 body
    let window: LeaveWindow = {
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      boundSessions: [],
    };
    if (body.sessionIds) {
      const resolved = await resolveBoundSessions(supabase, orgId, body.studentId, body.sessionIds);
      if (!resolved.ok) {
        return c.json(
          {
            error: '請假資料無效',
            code: 'INVALID_SESSION',
            message: resolved.message,
            sessionId: resolved.sessionId,
          },
          400,
        );
      }
      window = boundWindow(resolved.sessions);
    }

    // 1. 衝突檢查：同學生是否有重疊的請假紀錄（判準 `leavesConflict`）
    const overlap = await findConflictingLeave(supabase, orgId, body.studentId, window);

    if (overlap) {
      return c.json(
        {
          error: '請假時間重疊',
          message: `該學生在 ${overlap.start_date} ~ ${overlap.end_date} 已有請假紀錄`,
        },
        409,
      );
    }

    // 2. 建立請假紀錄
    const { data: leave, error: leaveError } = await supabase
      .from('leave_requests')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        start_date: window.startDate,
        end_date: window.endDate,
        start_time: body.startTime ?? null,
        end_time: body.endTime ?? null,
        reason: body.reason ?? null,
        submitted_by: userId,
        submitted_by_role: 'admin',
      })
      .select('*, students(name), ba_user!submitted_by(name)')
      .single();

    if (leaveError || !leave) {
      return c.json({ error: '新增請假失敗', message: leaveError?.message }, 500);
    }

    if (window.boundSessions.length > 0) {
      const { error: bindError } = await supabase.from('leave_request_sessions').insert(
        window.boundSessions.map((b) => ({
          leave_request_id: leave.id,
          session_id: b.sessionId,
          org_id: orgId,
        })),
      );
      if (bindError) {
        // 綁不上就不能留一張「整天」語意的假（沒有綁定列＝整天）—— 撤掉重來
        await inOrg(
          supabase
            .from('leave_requests')
            .delete()
            .eq('id', leave.id as string),
          orgId,
        );
        return c.json({ error: '新增請假失敗', message: bindError.message }, 500);
      }
    }

    // 3. 自動更新這張假蓋得到、且該學生實際有報名的 attendance_records → on_leave
    const syncedCount = await applyLeaveAttendance({
      supabase,
      orgId,
      studentId: body.studentId,
      recordedBy: userId,
      from: window.startDate,
      to: window.endDate,
      window,
    });

    if (syncedCount > 0) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'attendance',
          resourceId: leave.id as string,
          resourceName: buildLeaveAuditResourceName({
            studentName: (leave as any).students?.name ?? '',
            startDate: window.startDate,
            endDate: window.endDate,
          }),
          action: 'sync_leave_to_attendance',
          details: buildLeaveAttendanceAuditDetails(syncedCount),
        },
        waitUntilFrom(c),
      );
    }

    const row = {
      ...leave,
      student_name: (leave as any).students?.name ?? '',
      submitted_by_name: (leave as any).ba_user?.name ?? null,
      leave_request_sessions: window.boundSessions.map((b) => ({
        session_id: b.sessionId,
        sessions: { session_date: b.date },
      })),
    };

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'leave',
        resourceId: leave.id as string,
        resourceName: buildLeaveAuditResourceName({
          studentName: row.student_name,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
        action: 'create',
        details: {
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          reason: body.reason ?? null,
          sessionIds: window.boundSessions.map((b) => b.sessionId),
        },
      },
      waitUntilFrom(c),
    );

    return c.json(toLeaveResponse(row), 201);
  },
);

// PATCH /api/leaves/:id
//
// **這是第二條會改動既有請假區間的路徑，而且是第一條會「放寬」的。**
// DELETE 的 truncate 只讓區間變窄，繞不過 POST 的重疊檢查；編輯可以把區間拉長，
// 所以「請假不得重疊」這條**只活在路由碼裡、沒有 DB 約束**的不變量必須在這裡再守一次
// （而別的功能的正確性正靠著它 —— 見 leaves.spec.ts 的 POST 重疊那節）。
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id',
    tags: ['Leaves'],
    summary: '編輯請假（只同步真的變動的日期，已點名的日子維持不動）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: UpdateLeaveSchema } } },
    },
    responses: {
      200: {
        description: '更新後的請假紀錄',
        content: { 'application/json': { schema: LeaveRequestSchema } },
      },
      400: { description: '參數錯誤' },
      404: { description: '找不到請假紀錄' },
      409: { description: '請假時間重疊' },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // 一個欄位都沒帶就直接擋掉 —— 靜靜地什麼都沒做、然後回 200，
    // 跟「改成功了」在呼叫端長得一模一樣
    const updates: Record<string, unknown> = {};
    if (body.startDate !== undefined) updates['start_date'] = body.startDate;
    if (body.endDate !== undefined) updates['end_date'] = body.endDate;
    if (body.startTime !== undefined) updates['start_time'] = body.startTime;
    if (body.endTime !== undefined) updates['end_time'] = body.endTime;
    if (body.reason !== undefined) updates['reason'] = body.reason;

    if (Object.keys(updates).length === 0 && !body.sessionIds) {
      return c.json({ error: '請假資料無效', message: '沒有要更新的欄位' }, 400);
    }

    const { data: existing } = await supabase
      .from('leave_requests')
      .select(`id, student_id, students(name), ${LEAVE_WINDOW_COLUMNS}`)
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    const studentId = (existing as any).student_id as string;
    const scoped = await studentWriteScope(supabase, orgId, getCampusScope(c), studentId);
    if (scoped === 'not-found') {
      return c.json({ error: '學生不存在', code: 'NOT_FOUND' }, 404);
    }
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    const prevWindow = toLeaveWindow(existing as Record<string, unknown>);
    const prevBound = prevWindow.boundSessions.length > 0;

    if (body.sessionIds) {
      return updateBoundSessions(c, {
        id,
        studentId,
        studentName: (existing as any).students?.name ?? '',
        prevWindow,
        sessionIds: body.sessionIds,
        hasTime: !!(body.startTime || body.endTime),
        reason: body.reason,
      });
    }

    // 綁定型的假：日期與時間由堂次決定，要改請給 sessionIds
    if (
      prevBound &&
      (body.startDate !== undefined ||
        body.endDate !== undefined ||
        body.startTime !== undefined ||
        body.endTime !== undefined)
    ) {
      return c.json(
        { error: '請假資料無效', message: '勾選堂次的假請改勾選的堂次，不能直接改日期或時間' },
        400,
      );
    }

    const previous: LeaveDateRange = {
      startDate: (existing as any).start_date as string,
      endDate: (existing as any).end_date as string,
    };
    const next: LeaveDateRange = {
      startDate: body.startDate ?? previous.startDate,
      endDate: body.endDate ?? previous.endDate,
    };

    // 時間比較前先正規化 —— DB 回的是 `HH:MM:SS`、body 帶的是 `HH:MM`，
    // 混著比會讓 `15:00 < 15:00:00` 成立，於是同一個時間被判成顛倒
    const startTime =
      body.startTime !== undefined ? body.startTime : toHHmm((existing as any).start_time);
    const endTime = body.endTime !== undefined ? body.endTime : toHHmm((existing as any).end_time);

    const validationError = getLeaveValidationError({
      startDate: next.startDate,
      endDate: next.endDate,
      startTime,
      endTime,
    });
    if (validationError) {
      return c.json({ error: '請假資料無效', message: validationError }, 400);
    }

    const rangeChanged = next.startDate !== previous.startDate || next.endDate !== previous.endDate;

    // 只在區間真的動了才查重疊。**沒動就不查**不是省一支查詢而已 ——
    // 既有資料若已經有一組重疊（這條沒有 DB 約束，歷史資料進得來），
    // 每查必中會讓那張假連事由都改不了，永遠 409
    const nextWindow: LeaveWindow = {
      ...next,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      boundSessions: [],
    };

    if (rangeChanged) {
      // 排除自己 —— 少了 excludeId，每一次編輯都會跟自己撞成 409
      const overlap = await findConflictingLeave(supabase, orgId, studentId, nextWindow, id);

      if (overlap) {
        return c.json(
          {
            error: '請假時間重疊',
            message: `該學生在 ${overlap.start_date} ~ ${overlap.end_date} 已有請假紀錄`,
          },
          409,
        );
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('leave_requests')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select(`*, ${LEAVE_SESSIONS_EMBED}, students(name), ba_user!submitted_by(name)`)
      .single();

    if (updateError || !updated) {
      return c.json({ error: '更新請假失敗', message: updateError?.message }, 500);
    }

    const studentName = (existing as any).students?.name ?? '';

    // 只同步真的變動的那幾段。整段撤銷再整段寫回去的話，沒有變的日子會先被刪掉
    // `on_leave` 再補回來 —— 而「刪」只碰得到還沒點名的、「補」卻會覆蓋已點名的，
    // 同一天的紀錄會在一次編輯裡莫名換一個作者
    if (rangeChanged) {
      const { removed, added } = diffLeaveDateRanges(previous, next);

      let revertedCount = 0;
      for (const range of removed) {
        revertedCount += await revertLeaveAttendance({
          supabase,
          orgId,
          studentId,
          from: range.startDate,
          to: range.endDate,
          window: prevWindow,
        });
      }

      let syncedCount = 0;
      for (const range of added) {
        syncedCount += await applyLeaveAttendance({
          supabase,
          orgId,
          studentId,
          recordedBy: userId,
          from: range.startDate,
          to: range.endDate,
          window: nextWindow,
        });
      }

      // 稽核沿用刪除／建立那兩條路徑的 action 名稱 —— 同一件事在稽核上要查得到同一個字，
      // 否則「這張假的出勤被動過幾次」得先知道有幾種說法
      if (revertedCount > 0) {
        logAudit(
          supabase,
          {
            orgId,
            userId,
            resourceType: 'attendance',
            resourceId: id,
            resourceName: buildLeaveAuditResourceName({
              studentName,
              startDate: previous.startDate,
              endDate: previous.endDate,
            }),
            action: 'revert_leave_attendance',
            details: buildLeaveAttendanceAuditDetails(revertedCount),
          },
          waitUntilFrom(c),
        );
      }

      if (syncedCount > 0) {
        logAudit(
          supabase,
          {
            orgId,
            userId,
            resourceType: 'attendance',
            resourceId: id,
            resourceName: buildLeaveAuditResourceName({
              studentName,
              startDate: next.startDate,
              endDate: next.endDate,
            }),
            action: 'sync_leave_to_attendance',
            details: buildLeaveAttendanceAuditDetails(syncedCount),
          },
          waitUntilFrom(c),
        );
      }
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'leave',
        resourceId: id,
        resourceName: buildLeaveAuditResourceName({
          studentName,
          startDate: next.startDate,
          endDate: next.endDate,
        }),
        action: 'update',
        // 改成什麼要能事後查 —— 只記「有人改過」等於沒記
        details: { before: previous, after: next },
      },
      waitUntilFrom(c),
    );

    const row = {
      ...updated,
      student_name: (updated as any).students?.name ?? studentName,
      submitted_by_name: (updated as any).ba_user?.name ?? null,
    };

    return c.json(toLeaveResponse(row), 200);
  },
);

// DELETE /api/leaves/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Leaves'],
    summary: '刪除請假（未點名的日子回到無紀錄，已點名的維持不動）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      query: z.object({
        mode: z.enum(['truncate', 'full']).default('truncate').optional(),
      }),
    },
    responses: {
      204: { description: '已刪除' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const { mode = 'truncate' } = c.req.valid('query');

    // 1. 找到請假紀錄
    const { data: leave } = await supabase
      .from('leave_requests')
      .select(`id, student_id, students(name), ${LEAVE_WINDOW_COLUMNS}`)
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!leave) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }
    const scoped = await studentWriteScope(
      supabase,
      orgId,
      getCampusScope(c),
      (leave as any).student_id as string,
    );
    if (scoped === 'not-found') {
      return c.json({ error: '學生不存在', code: 'NOT_FOUND' }, 404);
    }
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    // 台北時間，不是 UTC —— Workers 跑在 UTC，`new Date().toISOString()` 在
    // 台北時間 00:00–08:00 之間會算成前一天（2026-09-06 main 全紅的根因）。
    const today = getCurrentTaipeiDateString();
    const startDate = (leave as any).start_date as string;
    const endDate = (leave as any).end_date as string;

    const window = toLeaveWindow(leave as Record<string, unknown>);
    const revertAttendance = (from: string, to: string, w: LeaveWindow = window) =>
      revertLeaveAttendance({
        supabase,
        orgId,
        studentId: (leave as any).student_id as string,
        from,
        to,
        window: w,
      });

    const isActive = startDate <= today && endDate >= today;
    const keptBound = window.boundSessions.filter((b) => b.date < today);

    // 綁定型的截斷（#1114）：拆掉今天起的綁定列、區間收到剩下的最後一堂；一堂都不剩就走整張刪除
    if (mode === 'truncate' && isActive && keptBound.length > 0) {
      const dropped = window.boundSessions.filter((b) => b.date >= today);
      await inOrg(
        supabase
          .from('leave_request_sessions')
          .delete()
          .eq('leave_request_id', id)
          .in(
            'session_id',
            dropped.map((b) => b.sessionId),
          ),
        orgId,
      );
      await inOrg(
        supabase
          .from('leave_requests')
          .update({ end_date: boundWindow(keptBound).endDate })
          .eq('id', id),
        orgId,
      );
      const droppedWindow = boundWindow(dropped);
      await revertAttendance(droppedWindow.startDate, droppedWindow.endDate, droppedWindow);
      return new Response(null, { status: 204 });
    }

    // truncate 模式且為進行中：保留過去，截斷今日起（沒綁定的假）。
    // **起始日＝今天時沒有過去可保留**（#1207）：改成昨天會留下 start > end 的倒置列，
    // 所以落到下面的整張刪除（同綁定型「一堂都不剩」那條）。
    if (mode === 'truncate' && isActive && startDate < today && window.boundSessions.length === 0) {
      // 同一支 today 算出來的昨天，不是另一個 UTC 算法 —— 兩個必須一致，
      // 否則會出現「今天用台北算、昨天用 UTC 算」的組合，比全錯更難 debug。
      const yesterday = addDaysToDateString(today, -1);
      await supabase
        .from('leave_requests')
        .update({ end_date: yesterday })
        .eq('id', id)
        .eq('org_id', orgId);
      const revertedCount = await revertAttendance(today, endDate);

      logAudit(
        supabase,
        {
          orgId,
          userId: c.get('userId'),
          resourceType: 'leave',
          resourceId: id,
          resourceName: buildLeaveAuditResourceName({
            studentName: (leave as any).students?.name ?? '',
            startDate,
            endDate,
          }),
          action: 'truncate_leave',
          details: { truncatedFrom: today, truncatedTo: yesterday },
        },
        waitUntilFrom(c),
      );

      if (revertedCount > 0) {
        logAudit(
          supabase,
          {
            orgId,
            userId: c.get('userId'),
            resourceType: 'attendance',
            resourceId: id,
            resourceName: buildLeaveAuditResourceName({
              studentName: (leave as any).students?.name ?? '',
              startDate,
              endDate,
            }),
            action: 'revert_leave_attendance',
            details: buildLeaveAttendanceAuditDetails(revertedCount),
          },
          waitUntilFrom(c),
        );
      }

      return new Response(null, { status: 204 });
    }

    // 其他情況（full 模式、未開始、已結束）：完整刪除
    await supabase.from('leave_requests').delete().eq('id', id).eq('org_id', orgId);
    const revertedCount = await revertAttendance(startDate, endDate);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'leave',
        resourceId: id,
        resourceName: buildLeaveAuditResourceName({
          studentName: (leave as any).students?.name ?? '',
          startDate,
          endDate,
        }),
        action: 'delete',
      },
      waitUntilFrom(c),
    );

    if (revertedCount > 0) {
      logAudit(
        supabase,
        {
          orgId,
          userId: c.get('userId'),
          resourceType: 'attendance',
          resourceId: id,
          resourceName: buildLeaveAuditResourceName({
            studentName: (leave as any).students?.name ?? '',
            startDate,
            endDate,
          }),
          action: 'revert_leave_attendance',
          details: buildLeaveAttendanceAuditDetails(revertedCount),
        },
        waitUntilFrom(c),
      );
    }

    return new Response(null, { status: 204 });
  },
);

export default app;
