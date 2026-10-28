import type { AttendanceStatus } from './session-pack';
import type { Queryable } from './identity-sql';

/**
 * 堂數帳「這個學生在這個班、沒停課的課堂上有哪些出勤」，改走 pg（#1928）。
 *
 * 原本兩步：先撈這個班**歷來所有**沒停課課堂的 event_id，再 `.in('event_id', 那一串)` 撈出勤。
 * 班開越久清單越長 → 414 → 錯誤被吞 → 已扣 0、剩餘＝已購；超過 1000 堂還會被 `max_rows` 截斷。
 * 這裡一條 SQL：子查詢挑課堂（條件跟原本一字不差：同班、`status <> 'cancelled'`、有 event），
 * 依狀態數好回傳。**扣不扣的規則不在這裡**：呼叫端照舊交給 `countDeductedSessions`。
 *
 * 用 `event_id in (子查詢)` 而不是 join：跟原本的 `.in()` 同一個語意（同一個 event 被兩堂課指到也只算一次）。
 * 失敗一律丟例外，呼叫端回 500。
 */
export async function attendanceStatusesViaSql(
  db: Queryable,
  p: { readonly orgId: string; readonly classId: string; readonly studentId: string },
): Promise<AttendanceStatus[]> {
  const { rows } = await db.query(
    `select ar.status, count(*)::int as n
       from public.attendance_records ar
      where ar.student_id = $3::uuid
        and ar.event_id in (
          select s.event_id from public.sessions s
           where s.org_id = $1::uuid
             and s.class_id = $2::uuid
             and s.status <> 'cancelled'
             and s.event_id is not null)
      group by ar.status`,
    [p.orgId, p.classId, p.studentId],
  );
  return (rows as Array<{ status: AttendanceStatus; n: number }>).flatMap((r) =>
    Array<AttendanceStatus>(r.n).fill(r.status),
  );
}
