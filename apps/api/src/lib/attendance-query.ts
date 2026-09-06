/**
 * 出勤紀錄的 select 字串與 row→回應的映射 —— **唯一定義**，`routes/attendance.ts`
 * （admin）與 `routes/parent/attendance.ts`（家長）共用，形狀照 `lib/session-summary.ts`
 * 的先例（查詢條件可以不一樣，形狀不行）。
 *
 * **`sessions.status` 一定要撈**（`sessionStatus`）：停課只改 `sessions.status`，
 * 那筆 event 與它上面的 `attendance_records` 都留著（請假連動寫的 `on_leave` 尤其
 * 常見）。少了這個欄位，**一堂沒上的課在家長端會長得跟一次正常的請假一模一樣** ——
 * 日期、班名、狀態點全部正常，沒有任何線索。而老師端同一件事有「停課」標籤，
 * 於是**兩個消費端對同一筆資料給出不同的說法**（issue #502）。
 *
 * 這不是前端漏做：**資料在到達畫面之前就已經不完整了**，前端就算想標也沒有那個欄位。
 */
export const ATTENDANCE_SELECT = `
  id, org_id, student_id, event_id, status, note, recorded_by, recorded_by_role, created_at, updated_at,
  students!inner(name),
  events!inner(event_date, start_time, end_time, campus_id, campuses(name), sessions(class_id, status, classes(name)))
`;

export function flattenAttendanceRow(r: Record<string, unknown>) {
  const students = r['students'] as { name?: string } | null;
  const events = r['events'] as {
    event_date?: string;
    start_time?: string | null;
    end_time?: string | null;
    campuses?: { name?: string } | null;
    sessions?: Array<{
      status?: string | null;
      classes?: { name?: string } | null;
    }> | null;
  } | null;

  return {
    id: r['id'] as string,
    org_id: r['org_id'] as string,
    student_id: r['student_id'] as string,
    student_name: students?.name ?? '',
    event_id: r['event_id'] as string,
    event_date: events?.event_date ?? '',
    start_time: events?.start_time ?? null,
    end_time: events?.end_time ?? null,
    campus_name: events?.campuses?.name ?? null,
    class_name: events?.sessions?.[0]?.classes?.name ?? null,
    // **沒有 session 的 event（活動、公告）回 null，不是猜一個預設值** ——
    // 回 `'scheduled'` 會讓「這不是課堂」跟「這是一堂正常的課」長得一樣
    session_status: events?.sessions?.[0]?.status ?? null,
    // ⚠️ 這個 `status` 是**出勤紀錄自己的**（present/absent/on_leave），
    // 跟上面的 `session_status`（scheduled/completed/cancelled）是兩件事。
    // 一堂停課的課上面可以有一筆 on_leave —— 兩個都要說得出來
    status: r['status'] as 'present' | 'absent' | 'on_leave',
    note: (r['note'] as string | null) ?? null,
    recorded_by: (r['recorded_by'] as string | null) ?? null,
    recorded_by_role: (r['recorded_by_role'] as string | null) ?? null,
    created_at: r['created_at'] as string,
    updated_at: r['updated_at'] as string,
  };
}

export function toAttendanceResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    eventId: row['event_id'] as string,
    eventDate: row['event_date'] as string,
    startTime: (row['start_time'] as string | null) ?? null,
    endTime: (row['end_time'] as string | null) ?? null,
    campusName: (row['campus_name'] as string | null) ?? null,
    className: (row['class_name'] as string | null) ?? null,
    /** 課堂本身的狀態。`null` = 這個 event 沒有對應的課堂（活動、公告） */
    sessionStatus: (row['session_status'] as 'scheduled' | 'completed' | 'cancelled' | null) ?? null,
    status: row['status'] as 'present' | 'absent' | 'on_leave',
    note: (row['note'] as string | null) ?? null,
    recordedBy: (row['recorded_by'] as string | null) ?? null,
    recordedByRole: (row['recorded_by_role'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}
