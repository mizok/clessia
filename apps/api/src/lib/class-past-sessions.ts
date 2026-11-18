/**
 * 「這堂課發生過」的判準（#2544）—— **班級刪除保護與列表的 `hasPastSessions` 共用這一份**。
 *
 * - 點名制分校：只有點過名（`completed`，#2546 起點名提交就寫）才算發生。過期但沒點名、停課的都不算
 * - 日到班分校：沒有點名這個動作（#2546 的 `completeTakenSessions` 刻意不動日到班），維持日期判斷：
 *   台北今天以前、且沒停課
 * - 分校模式：`campuses.attendance_mode`，null 沿用機構預設（同 `lib/attendance-mode.ts`）
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
        and (select coalesce(cp.attendance_mode, o.attendance_mode)
               from classes c
               join campuses cp on cp.id = c.campus_id
               join organizations o on o.id = c.org_id
              where c.id = s.class_id) = 'daily_checkin')
  )`;
}
