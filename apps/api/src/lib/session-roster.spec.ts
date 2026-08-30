import { describe, expect, it } from 'vitest';

import { countEnrolledOn, tallyAttendance } from './session-roster';

const enrollment = (classId: string, from: string, to: string | null) => ({
  classId,
  effectiveFrom: from,
  effectiveTo: to,
});

describe('countEnrolledOn', () => {
  const rows = [
    enrollment('c1', '2026-01-01', null),
    enrollment('c1', '2026-01-01', '2026-03-15'),
    enrollment('c1', '2026-04-01', null),
    enrollment('c2', '2026-01-01', null),
  ];

  it('只算這個班的', () => {
    expect(countEnrolledOn(rows, 'c2', '2026-03-01')).toBe(1);
  });

  it('還沒生效的不算', () => {
    // c1 的第三筆 2026-04-01 才開始
    expect(countEnrolledOn(rows, 'c1', '2026-03-01')).toBe(2);
    expect(countEnrolledOn(rows, 'c1', '2026-04-02')).toBe(2);
  });

  it('已經結束的不算，結束當天還算', () => {
    expect(countEnrolledOn(rows, 'c1', '2026-03-15')).toBe(2);
    expect(countEnrolledOn(rows, 'c1', '2026-03-16')).toBe(1);
  });

  // effective_to 是 null 代表還在讀 —— 不能當成「已經結束」
  it('沒有結束日的一直算', () => {
    expect(countEnrolledOn(rows, 'c1', '2030-01-01')).toBe(2);
  });

  /**
   * 沒有日期的課堂（尚未排定時間）就不套生效區間，只算這個班還在籍的人 ——
   * 原本的實作會把 `null` 丟進 `.lte('effective_from', null)`，那個查詢的結果
   * 沒有人說得準。
   */
  it('沒有日期時只依班級算，不套區間', () => {
    expect(countEnrolledOn(rows, 'c1', null)).toBe(3);
  });
});

describe('tallyAttendance', () => {
  it('依 event 分組計數', () => {
    const tally = tallyAttendance([
      { eventId: 'e1', status: 'present' },
      { eventId: 'e1', status: 'present' },
      { eventId: 'e1', status: 'absent' },
      { eventId: 'e2', status: 'on_leave' },
    ]);

    expect(tally.get('e1')).toEqual({ presentCount: 2, onLeaveCount: 0, absentCount: 1 });
    expect(tally.get('e2')).toEqual({ presentCount: 0, onLeaveCount: 1, absentCount: 0 });
  });

  // 沒有出勤記錄的 event 不會出現在 map 裡 —— 呼叫端要自己給零值
  it('沒有記錄的 event 不在結果裡', () => {
    expect(tallyAttendance([]).get('e1')).toBeUndefined();
  });

  // 狀態只有三種（present / absent / on_leave）。未知值不該被算進任何一欄
  it('未知狀態不計入任何一欄', () => {
    const tally = tallyAttendance([{ eventId: 'e1', status: 'late' }]);

    expect(tally.get('e1')).toEqual({ presentCount: 0, onLeaveCount: 0, absentCount: 0 });
  });
});
