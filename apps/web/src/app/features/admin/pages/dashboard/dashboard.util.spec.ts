import { missingReason, missingText, pendingAttendanceQuery } from './dashboard.util';

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
      statuses: ['scheduled', 'completed'],
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

  // #456：這裡明著送 statuses，就是為了不吃 `GET /api/attendance/sessions` 的
  // API 預設。**這條的意義不在於值是什麼，在於值是從這裡來的** ——
  // 有人把它刪掉、想「反正 API 預設一樣」，卡片就又回到靠巧合相等。
  it('statuses 明著送，不留給 API 預設決定', () => {
    expect(pendingAttendanceQuery(NOON, 7).statuses).toEqual(['scheduled', 'completed']);
  });

  // 陷阱：停課不該進「未點名」——它不會發生，後端也不替它補建出勤事件。
  // 有人為了「看得比較全」把 cancelled 加進來，這條會紅。
  it('陷阱：statuses 不含 cancelled', () => {
    expect(pendingAttendanceQuery(NOON, 7).statuses).not.toContain('cancelled');
  });
});

describe('missingReason', () => {
  const first = { startTime: '15:30', className: '國三數學' };
  const sessions = [
    { startTime: '15:30', endTime: '17:00', className: '國三數學', status: 'scheduled' },
  ];
  const at = (h: number, m: number) => h * 60 + m;

  it('還沒到上課時間 → 不算該到沒到', () => {
    expect(missingReason(first, sessions, at(15, 29))).toBeNull();
  });

  it('剛好開始 → 上課 0 分鐘', () => {
    expect(missingReason(first, sessions, at(15, 30))).toEqual({ kind: 'started', minutes: 0 });
  });

  it('上到一半 → 上課 N 分鐘', () => {
    expect(missingReason(first, sessions, at(16, 10))).toEqual({ kind: 'started', minutes: 40 });
  });

  it('下課時間到就是已下課', () => {
    expect(missingReason(first, sessions, at(17, 0))).toEqual({ kind: 'ended' });
  });

  it('停課的堂不算', () => {
    expect(missingReason(first, [{ ...sessions[0], status: 'cancelled' }], at(16, 0))).toBeNull();
  });

  it('沒有第一堂 → 不算', () => {
    expect(missingReason(null, sessions, at(16, 0))).toBeNull();
  });

  it('對不到課表時用開始時間判斷', () => {
    expect(missingReason(first, [], at(16, 0))).toEqual({ kind: 'started', minutes: 30 });
  });
});

describe('missingText', () => {
  it('短句', () => {
    expect(missingText({ kind: 'ended' })).toBe('已下課，今天沒掃碼');
    expect(missingText({ kind: 'started', minutes: 40 })).toBe('上課 40 分鐘了，還沒掃碼');
    expect(missingText({ kind: 'started', minutes: 75 })).toBe('上課 1 小時 15 分了，還沒掃碼');
    expect(missingText({ kind: 'started', minutes: 120 })).toBe('上課 2 小時了，還沒掃碼');
  });
});
