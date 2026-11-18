/**
 * `routes/attendance.ts` 各支 PostgREST 查詢回來的形狀（#2545）。**只有型別，編譯後不存在。**
 *
 * `c.get('supabase')` 沒帶 `Database` 泛型，postgrest-js 推不出 embed，原本一路 `as any`。
 * 這裡照每支查詢的 select 字串手寫。embed 的物件／陣列對本機 PostgREST 實測過（2026-11-18）：
 * **多對一（students、events、campuses、classes、courses、schools）回物件；
 * 一對多的 `events.sessions` 回陣列。** 改 select 字串時，這裡要跟著改 —— 型別不會自己跟上。
 *
 * postgrest-js 沒有 schema 時會把**每個** embed 推成陣列（它不知道 FK 的方向），所以多對一的
 * 那幾支在 attendance.ts 是 `as unknown as` —— 推論是錯的，實測的形狀才是對的。
 */

interface CourseName {
  name: string | null;
}

interface ClassWithCourse {
  name: string | null;
  courses: CourseName | null;
}

/** `'*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name), sessions(classes(name, courses(name))))'` */
export interface AttendanceRecordWithEmbeds {
  // `*`：attendance_records 的欄位（對本機 DB 的 information_schema 核過）
  id: string;
  org_id: string;
  event_id: string;
  student_id: string;
  status: 'present' | 'absent' | 'on_leave';
  note: string | null;
  recorded_by: string | null;
  recorded_by_role: string | null;
  created_at: string;
  updated_at: string;
  students: { name: string | null } | null;
  events: {
    event_date: string;
    start_time: string | null;
    end_time: string | null;
    campus_id: string | null;
    campuses: { name: string | null } | null;
    sessions: Array<{ classes: ClassWithCourse | null }>;
  } | null;
}

/** 批次點名：`'id, attendance_taken_at, event_date, start_time, end_time, campus_id, sessions(id, status, class_id, classes(name, courses(name)))'` */
export interface EventForBatchWrite {
  id: string;
  attendance_taken_at: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  campus_id: string | null;
  sessions: Array<{
    id: string;
    status: string;
    class_id: string;
    classes: ClassWithCourse | null;
  }>;
}

/** 單筆更新前讀的那一筆：`'event_id, events(event_date, campus_id)'` */
export interface RecordEventRef {
  event_id: string;
  events: { event_date: string; campus_id: string | null } | null;
}

/** 點名名單：`'id, event_date, start_time, end_time, attendance_taken_at, campus_id, sessions(id, class_id)'` */
export interface EventForRoster {
  id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  attendance_taken_at: string | null;
  campus_id: string | null;
  sessions: Array<{ id: string; class_id: string }>;
}

/** 點名名單的報名：`'student_id, effective_from, effective_to, students(name, grade, schools(id, name, short_name))'` */
export interface RosterEnrollmentRow {
  student_id: string;
  effective_from: string;
  effective_to: string | null;
  students: {
    name: string | null;
    grade: string | null;
    schools: { id: string; name: string | null; short_name: string | null } | null;
  } | null;
}

/** 學生單日：`'class_id, effective_from, effective_to, classes!inner(name, campus_id)'` */
export interface StudentDayEnrollmentRow {
  class_id: string;
  effective_from: string;
  effective_to: string | null;
  classes: { name: string | null; campus_id: string | null } | null;
}

/** 手動記到班：`'id, event_date, campus_id, sessions(class_id)'` */
export interface EventForCheckin {
  id: string;
  event_date: string;
  campus_id: string | null;
  sessions: Array<{ class_id: string }>;
}

/** `extractAttendanceAuditContext` 讀的那幾個欄位：可以是帶 `events` embed 的紀錄，也可以是 event 本身 */
export interface AuditEventSource {
  event_date?: string | null;
  start_time?: string | null;
  sessions?:
    Array<{ classes?: ClassWithCourse | null }> | { classes?: ClassWithCourse | null } | null;
  events?: AuditEventSource | null;
}
