/**
 * `routes/leaves.ts` 各支查詢回來的形狀（#2545 第二片）。**只有型別，編譯後不存在。**
 *
 * 同 `routes/attendance/rows.ts`：`c.get('supabase')` 沒帶 `Database` 泛型，embed 推不出來，
 * 這裡照 select 字串手寫。對本機 PostgREST 實測（2026-11-18）：`students`、`ba_user`、
 * `events`、`classes` 回物件；`leave_request_sessions`、`events.sessions`、`classes.enrollments` 回陣列。
 * pg 那條路（`lib/leave-write.ts` 的 `LEAVE_ROW_JSON`）用 `jsonb_build_object` 造出同一個形狀。
 *
 * 用 `type` 不用 `interface`：這些列會交給吃 `Record<string, unknown>` 的 `toLeaveWindow`／
 * `toLeaveResponse`，interface 沒有隱式索引簽章、傳不進去。
 */

/** `leave_requests` 的欄位（對本機 DB 的 information_schema 核過） */
type LeaveRequestColumns = {
  id: string;
  org_id: string;
  student_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  submitted_by: string;
  submitted_by_role: string;
  created_at: string;
  updated_at: string;
  start_time: string | null;
  end_time: string | null;
};

/** `LEAVE_SESSIONS_EMBED`：`leave_request_sessions(session_id, sessions(session_date))` */
type LeaveSessionBinding = {
  session_id: string;
  sessions: { session_date: string } | null;
};

/** `*, LEAVE_SESSIONS_EMBED, students(name[, grade]), ba_user!submitted_by(name)`；pg 路徑的 `LEAVE_ROW_JSON` 同形 */
export type LeaveWithEmbeds = LeaveRequestColumns & {
  leave_request_sessions: LeaveSessionBinding[];
  students: { name: string | null; grade?: string | null } | null;
  ba_user: { name: string | null } | null;
};

/** `id, student_id, students(name), LEAVE_WINDOW_COLUMNS` */
export type LeaveWithStudentWindow = Pick<
  LeaveRequestColumns,
  'id' | 'student_id' | 'start_date' | 'end_date' | 'start_time' | 'end_time'
> & {
  students: { name: string | null } | null;
  leave_request_sessions: LeaveSessionBinding[];
};

/** 綁定堂次前的檢查：`id, session_date, class_id, status` */
export type SessionForBinding = {
  id: string;
  session_date: string;
  class_id: string;
  status: string;
};

/** 撤請假出勤：`id, events!inner(id, event_date, start_time, end_time, sessions(id))`（`!inner` → events 不為 null） */
export type OnLeaveRecordWithEvent = {
  id: string;
  events: {
    id: string;
    event_date: string;
    start_time: string | null;
    end_time: string | null;
    sessions: Array<{ id: string }>;
  };
};
