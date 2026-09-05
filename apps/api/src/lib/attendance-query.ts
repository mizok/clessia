/**
 * 出勤紀錄的 select 字串與 row→回應的映射 —— **唯一定義**，`routes/attendance.ts`
 * （admin）與 `routes/parent/attendance.ts`（家長）共用，形狀照 `lib/session-summary.ts`
 * 的先例（查詢條件可以不一樣，形狀不行）。
 */
export const ATTENDANCE_SELECT = `
  id, org_id, student_id, event_id, status, note, recorded_by, recorded_by_role, created_at, updated_at,
  students!inner(name),
  events!inner(event_date, start_time, end_time, campus_id, campuses(name), sessions(class_id, classes(name)))
`;

export function flattenAttendanceRow(r: Record<string, unknown>) {
  const students = r['students'] as { name?: string } | null;
  const events = r['events'] as {
    event_date?: string;
    start_time?: string | null;
    end_time?: string | null;
    campuses?: { name?: string } | null;
    sessions?: Array<{ classes?: { name?: string } | null }> | null;
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
    status: row['status'] as 'present' | 'absent' | 'on_leave',
    note: (row['note'] as string | null) ?? null,
    recordedBy: (row['recorded_by'] as string | null) ?? null,
    recordedByRole: (row['recorded_by_role'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}
