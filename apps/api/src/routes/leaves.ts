import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { SupabaseClient } from '@supabase/supabase-js';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';

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

interface LeaveAttendanceEventRow {
  readonly id: string;
  readonly event_date: string;
  readonly sessions: { class_id: string } | Array<{ class_id: string }> | null;
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
        const sessionRows = Array.isArray(eventRow.sessions)
          ? eventRow.sessions
          : eventRow.sessions
            ? [eventRow.sessions]
            : [];

        return sessionRows.some(
          (sessionRow) =>
            enrollment.class_id === sessionRow.class_id &&
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

  const { data: events } = await supabase
    .from('events')
    .select('id, event_date, sessions!inner(class_id)')
    .eq('org_id', orgId)
    .eq('event_type', 'session')
    .gte('event_date', from)
    .lte('event_date', to);

  if (!events || events.length === 0) return 0;

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

  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('org_id', orgId)
    .is('attendance_taken_at', null)
    .gte('event_date', from)
    .lte('event_date', to);

  if (!events || events.length === 0) return 0;

  const { data: removed } = await supabase
    .from('attendance_records')
    .delete()
    .eq('student_id', studentId)
    .eq('status', 'on_leave')
    .in(
      'event_id',
      events.map((e: { id: string }) => e.id),
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
  };
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
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

    let query = supabase
      .from('leave_requests')
      .select(`*, students!inner(name), ba_user!submitted_by(name)`, { count: 'exact' })
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (dateFrom) query = query.gte('start_date', dateFrom);
    if (dateTo) query = query.lte('end_date', dateTo);
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
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

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

    const validationError = getLeaveValidationError(body);
    if (validationError) {
      return c.json({ error: '請假資料無效', message: validationError }, 400);
    }

    // 1. 衝突檢查：同學生是否有重疊的請假紀錄
    const { data: conflicts } = await supabase
      .from('leave_requests')
      .select('id, start_date, end_date')
      .eq('org_id', orgId)
      .eq('student_id', body.studentId)
      .lte('start_date', body.endDate)
      .gte('end_date', body.startDate);

    if (conflicts && conflicts.length > 0) {
      const overlap = conflicts[0] as { start_date: string; end_date: string };
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
        start_date: body.startDate,
        end_date: body.endDate,
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

    // 3. 自動更新對應日期範圍內、且該學生實際有報名的 attendance_records → on_leave
    const syncedCount = await applyLeaveAttendance({
      supabase,
      orgId,
      studentId: body.studentId,
      recordedBy: userId,
      from: body.startDate,
      to: body.endDate,
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
            startDate: body.startDate,
            endDate: body.endDate,
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
          startDate: body.startDate,
          endDate: body.endDate,
        }),
        action: 'create',
        details: {
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          reason: body.reason ?? null,
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

    if (Object.keys(updates).length === 0) {
      return c.json({ error: '請假資料無效', message: '沒有要更新的欄位' }, 400);
    }

    const { data: existing } = await supabase
      .from('leave_requests')
      .select('id, student_id, start_date, end_date, start_time, end_time, students(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    const studentId = (existing as any).student_id as string;
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

    const rangeChanged =
      next.startDate !== previous.startDate || next.endDate !== previous.endDate;

    // 只在區間真的動了才查重疊。**沒動就不查**不是省一支查詢而已 ——
    // 既有資料若已經有一組重疊（這條沒有 DB 約束，歷史資料進得來），
    // 每查必中會讓那張假連事由都改不了，永遠 409
    if (rangeChanged) {
      const { data: conflicts } = await supabase
        .from('leave_requests')
        .select('id, start_date, end_date')
        .eq('org_id', orgId)
        .eq('student_id', studentId)
        // 排除自己 —— 少了這行，每一次編輯都會跟自己撞成 409
        .neq('id', id)
        .lte('start_date', next.endDate)
        .gte('end_date', next.startDate);

      if (conflicts && conflicts.length > 0) {
        const overlap = conflicts[0] as { start_date: string; end_date: string };
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
      .select('*, students(name), ba_user!submitted_by(name)')
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
      .select('id, student_id, start_date, end_date, students(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!leave) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    // 台北時間，不是 UTC —— Workers 跑在 UTC，`new Date().toISOString()` 在
    // 台北時間 00:00–08:00 之間會算成前一天（2026-09-06 main 全紅的根因）。
    const today = getCurrentTaipeiDateString();
    const startDate = (leave as any).start_date as string;
    const endDate = (leave as any).end_date as string;

    const revertAttendance = (from: string, to: string) =>
      revertLeaveAttendance({
        supabase,
        orgId,
        studentId: (leave as any).student_id as string,
        from,
        to,
      });

    const isActive = startDate <= today && endDate >= today;

    // truncate 模式且為進行中：保留過去，截斷今日起
    if (mode === 'truncate' && isActive) {
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
