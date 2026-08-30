/**
 * 出勤的補登窗 —— **伺服器端**的判斷。
 *
 * 在 2026-08-30 之前這個窗只在前端讀（`teacher/schedule.page.ts:122-127`），
 * 老師直接打 API 可以改任何日期的出勤。前端隱藏不構成限制，跟 c1 的道理一樣。
 *
 * **這支是把前端已經在做的規則搬到伺服器，不是改變規則**，所以它照抄前端的
 * **兩個**條件：
 *
 * 1. 只有 `attendance_responsible = 'teacher'` 的機構才鎖 —— 行政負責點名的機構，
 *    老師本來就不該被這個窗擋
 * 2. `retroactiveDays === 0` 代表**無限制**（欄位 COMMENT，`20260401000001:21`），
 *    **不是「只有當天」**。這是目前所有機構的值，寫反的話一上線就把全部的人鎖在當天
 *
 * 管理員豁免（裁決 B1）：現行 spec 就寫「修改過期出勤需找管理員」—— 擋住管理員等於把
 * 逃生門焊死，會逼出「改設定 → 改資料 → 改回設定」這個更難稽核的繞道。代價是管理員
 * 在窗外的修改要留痕（呼叫端負責寫 audit log）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function isAttendanceEditable(input: {
  isAdmin: boolean;
  /** `organizations.attendance_responsible` */
  responsible: 'admin' | 'teacher';
  /** `organizations.attendance_retroactive_days`，0 = 無限制 */
  retroactiveDays: number;
  eventDate: string;
  today: string;
}): boolean {
  if (input.isAdmin) return true;
  if (input.responsible !== 'teacher') return true;
  if (input.retroactiveDays <= 0) return true;

  const elapsedDays = Math.round(
    (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${input.eventDate}T00:00:00Z`)) / DAY_MS,
  );

  return elapsedDays <= input.retroactiveDays;
}
