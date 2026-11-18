/**
 * 「這堂課發生過」的判準（#2544）—— **班級刪除保護與列表的 `hasPastSessions` 共用這一份**。
 *
 * - 點名制分校：只有點過名（`completed`，#2546 起點名提交就寫）才算發生。過期但沒點名、停課的都不算
 * - 日到班分校：沒有點名這個動作（#2546 的 `completeTakenSessions` 刻意不動日到班），維持日期判斷：
 *   台北今天以前、且沒停課
 * - 分校模式：`coalesce(分校, 機構, 'daily_checkin')` —— 跟 `lib/attendance-mode.ts` 的 `pickAttendanceMode`、
 *   #2559 backfill 同一式。`organizations.attendance_mode` 與 `classes.campus_id` 現在都 NOT NULL，
 *   最後那個預設與 left join 是防呆：哪天放寬了，也不會變成 NULL → 條件不成立 → 班被當沒發生而可刪
 *
 * 計畫席 11-18 裁（#2544）：停課的堂無論哪種模式都沒發生。
 *
 * 用法：`from sessions s where … and ${pastSessionSql('$3::date')}` —— 模式用相關子查詢自己帶，
 * 呼叫端的 from 不用跟著 join。
 */
export function pastSessionSql(today: string): string {
  return `(
    s.status = 'completed'
    or (s.session_date < ${today} and s.status <> 'cancelled'
        and (select coalesce(cp.attendance_mode, o.attendance_mode, 'daily_checkin')
               from classes c
               left join campuses cp on cp.id = c.campus_id
               left join organizations o on o.id = c.org_id
              where c.id = s.class_id) = 'daily_checkin')
  )`;
}
