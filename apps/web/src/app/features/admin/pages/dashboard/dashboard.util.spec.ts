import { pendingAttendanceQuery } from './dashboard.util';

/**
 * `pendingAttendanceQuery` 是未點名課堂卡片的**唯一**篩選定義來源——
 * 儀表板算數字用它，卡片連到課堂管理頁時的 `queryParams` 也用它
 * （見 kb/wiki/architecture/admin-todo-alerts.md 的 P1-6）。
 *
 * 「已結束」的判斷本身（跨午夜、沒有結束時間、停課排除……）現在活在後端
 * `hasSessionEndedByNow` / `endedOnly` 裡，這裡不重複測那些情境——
 * 這支函式只負責組出正確的查詢參數，不做任何判斷。
 */
describe('pendingAttendanceQuery', () => {
  const NOON = new Date('2026-08-29T12:00:00');

  it('dateFrom 是回溯天數之前，dateTo 是今天', () => {
    expect(pendingAttendanceQuery(NOON, 7)).toEqual({
      dateFrom: '2026-08-22',
      dateTo: '2026-08-29',
      attendanceTaken: false,
      endedOnly: true,
    });
  });

  it('回溯天數變了，dateFrom 跟著變，dateTo 不變', () => {
    expect(pendingAttendanceQuery(NOON, 3).dateFrom).toBe('2026-08-26');
    expect(pendingAttendanceQuery(NOON, 3).dateTo).toBe('2026-08-29');
  });

  // 這條是陷阱：如果有人把 dateTo 改回「昨天」（回到拆兩段查以前的寫法），
  // 這條會紅——證明測試真的在盯著這個值，不是巧合通過
  it('dateTo 是今天，不是昨天 —— endedOnly 已經排除今天還沒上完的課', () => {
    expect(pendingAttendanceQuery(NOON, 7).dateTo).not.toBe('2026-08-28');
  });

  it('attendanceTaken 與 endedOnly 永遠是這兩個值', () => {
    const result = pendingAttendanceQuery(NOON, 7);
    expect(result.attendanceTaken).toBe(false);
    expect(result.endedOnly).toBe(true);
  });
});
