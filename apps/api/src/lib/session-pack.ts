/**
 * 剩餘堂數是**推導**出來的，不是計數器。
 *
 * 存計數器的話，出勤被事後修正（改點名、補請假、刪掉一堂課）就會飄，而飄了之後
 * 沒有人查得出來差在哪。推導的版本在來源被改動時自己就對了。
 *
 * 見 kb/wiki/rules/billing-rules.md 規則 1 與 8。
 */

export type AttendanceStatus = 'present' | 'absent' | 'on_leave';

export interface PurchasedPack {
  purchasedCount: number;
}

/**
 * 這些出勤記錄扣掉幾堂。
 *
 * - `present`、`absent` **一律扣**。學生佔了那個位子沒來，堂數照消耗 —— 這件事
 *   沒有爭議，所以它不是設定值。
 * - `on_leave` 看 `classes.leave_deducts_session`。**這是堂數制唯一的結構化決定**
 *   （規則 8）：各家補習班對「請假那堂扣不扣」的做法不同。
 *
 * ⚠️ **呼叫端負責把出勤記錄過濾到正確的班。** `attendance_records` 是
 * (event, student) 粒度，要經 `sessions.event_id → sessions.class_id` 濾到這包堂數
 * 對應 enrollment 的班；不濾的話會把別班的出席也算進來（daily_checkin 模式尤其明顯 ——
 * 那個模式的衍生記錄是「當天分校所有 events」）。
 *
 * ⚠️ **daily_checkin 模式下沒打卡 = 沒有記錄，不是 absent。** 所以那個模式的缺席
 * 要人工補登才會扣到。這是資料完整性的已知邊界不是公式問題 —— 公式照「數有記錄的」
 * 走，少記就少扣（少收不多收，錯的方向是安全的那邊）。
 */
export function countDeductedSessions(
  statuses: AttendanceStatus[],
  leaveDeductsSession: boolean,
): number {
  return statuses.filter(
    (status) =>
      status === 'present' || status === 'absent' || (status === 'on_leave' && leaveDeductsSession),
  ).length;
}

/**
 * 剩餘堂數 = Σ購買 − Σ應扣。
 *
 * **可以是負數，刻意不 clamp 到 0。** 規則 1：堂數用完不硬擋上課，剩餘 ≤ 0 時警示
 * 行政追補買 —— clamp 掉的話「超上了三堂」會顯示成「剛好用完」，該追的補買就追不到了。
 * 那個負號正是這個數字存在的理由。
 *
 * `expires_at` 不在這裡處理：哪幾包還算數是呼叫端的政策決定（受訪公司不設效期），
 * 這裡只做算術。
 */
export function remainingSessions(
  packs: PurchasedPack[],
  statuses: AttendanceStatus[],
  leaveDeductsSession: boolean,
): number {
  const purchased = packs.reduce((sum, pack) => sum + pack.purchasedCount, 0);

  return purchased - countDeductedSessions(statuses, leaveDeductsSession);
}
