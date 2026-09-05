import { countUntakenSessions } from './dashboard.util';
import type { EventSessionSummary } from '@core/attendance.service';

function session(overrides: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    sessionId: 's1',
    status: 'scheduled',
    isSubstitute: false,
    examCount: 0,
    classId: 'c1',
    className: '數學班 A',
    courseName: '數學',
    teacherName: '王老師',
    campusId: null,
    campusName: null,
    eventDate: '2026-08-25',
    startTime: '09:00',
    endTime: '11:00',
    enrolledCount: 8,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
    ...overrides,
  };
}

/** 2026-08-29 週六中午；回溯 7 天的窗是 08-22 ~ 08-29 */
const NOON = new Date('2026-08-29T12:00:00');

describe('countUntakenSessions', () => {
  it('上完了又沒點名的算漏點名', () => {
    expect(countUntakenSessions([session()], 'per_session', NOON)).toBe(1);
  });

  it('點過名的不算', () => {
    const taken = session({ takenAt: '2026-08-25T11:05:00Z' });

    expect(countUntakenSessions([taken], 'per_session', NOON)).toBe(0);
  });

  // 全班缺席也是點過名 —— 用 presentCount 判斷會把它誤判成沒點名
  it('全班缺席但有點名，不算漏點名', () => {
    const taken = session({ takenAt: '2026-08-25T11:05:00Z', absentCount: 8 });

    expect(countUntakenSessions([taken], 'per_session', NOON)).toBe(0);
  });

  // 還沒上完的課當然沒點名，算進去會讓卡片整天都在誤報
  it('今天還沒結束的課不算漏點名', () => {
    const tonight = session({ eventDate: '2026-08-29', startTime: '19:00', endTime: '21:00' });

    expect(countUntakenSessions([tonight], 'per_session', NOON)).toBe(0);
  });

  it('今天已經結束的課算漏點名', () => {
    const morning = session({ eventDate: '2026-08-29', startTime: '09:00', endTime: '11:00' });

    expect(countUntakenSessions([morning], 'per_session', NOON)).toBe(1);
  });

  it('剛好結束在此刻的課算漏點名', () => {
    const justEnded = session({ eventDate: '2026-08-29', startTime: '10:00', endTime: '12:00' });

    expect(countUntakenSessions([justEnded], 'per_session', NOON)).toBe(1);
  });

  // 沒有結束時間就無從判斷今天那堂上完了沒，等這天過完再算
  it('沒有結束時間的課，當天不算、隔天才算', () => {
    const today = session({ eventDate: '2026-08-29', startTime: null, endTime: null });
    const yesterday = session({ eventDate: '2026-08-28', startTime: null, endTime: null });

    expect(countUntakenSessions([today], 'per_session', NOON)).toBe(0);
    expect(countUntakenSessions([yesterday], 'per_session', NOON)).toBe(1);
  });

  // 跨午夜的課結束在隔天，用當天的日期比會提早誤判成已結束
  it('跨午夜的課要算到隔天才結束', () => {
    const overnight = session({ eventDate: '2026-08-29', startTime: '22:00', endTime: '00:30' });

    expect(countUntakenSessions([overnight], 'per_session', NOON)).toBe(0);

    const nextNoon = new Date('2026-08-30T12:00:00');
    expect(countUntakenSessions([overnight], 'per_session', nextNoon)).toBe(1);
  });

  // daily-checkins 建立 attendance_records 但從不蓋 events.attendance_taken_at，
  // 這個模式下每一堂推算出席的課都會被誤判成漏點名 —— 整張卡不該存在
  it('日到班模式回傳 null（卡片不渲染）', () => {
    expect(countUntakenSessions([session()], 'daily_checkin', NOON)).toBeNull();
  });

  it('日到班模式即使沒有課堂也回傳 null，不是 0', () => {
    expect(countUntakenSessions([], 'daily_checkin', NOON)).toBeNull();
  });

  it('沒有課堂時是 0', () => {
    expect(countUntakenSessions([], 'per_session', NOON)).toBe(0);
  });

  // 停課不算「忘了點名」—— 而昨天以前那段走 API（`attendanceTaken=false` 用 inner join，
  // 沒有出勤事件的課堂本來就撈不到），今天這段如果不排除就是同一張卡兩套規則
  it('停課的課堂不算未點名', () => {
    const cancelled = session({ status: 'cancelled', takenAt: null });

    expect(countUntakenSessions([cancelled], 'per_session', NOON)).toBe(0);
  });

  it('停課與正常課混在一起時只數正常的', () => {
    const rows = [
      session({ eventId: 'a', status: 'cancelled', takenAt: null }),
      session({ eventId: 'b', status: 'scheduled', takenAt: null }),
    ];

    expect(countUntakenSessions(rows, 'per_session', NOON)).toBe(1);
  });
});

/**
 * 未點名卡的**兩段並排**。
 *
 * 那張卡的數字來自兩個地方，而它們用不同的機制判斷「這堂算不算逾期未點名」：
 *
 * | 條件 | 昨天以前（API `attendanceTaken=false`） | 今天（前端 `countUntakenSessions`） |
 * | --- | --- | --- |
 * | 沒點名 | `events.attendance_taken_at IS NULL` | `!takenAt` |
 * | 排除停課 | 帶參數時改 **inner join**，停課沒有 event 撈不到（#123） | `status !== 'cancelled'` |
 * | **已經上完** | **沒有這個條件** | `hasSessionEnded(...)` |
 *
 * **最後一列是這組測試存在的理由。** API 側沒有「已結束」的概念，它之所以不會把
 * 還沒上的課算進去，**完全是靠呼叫端只查到昨天**（昨天的課今天都結束了）。
 * 那是一個藏在參數裡的前提 —— 有人把 `dateTo` 改回今天，這張卡就會在每天早上
 * 把整批還沒上的課報成未點名，而**兩段各自看都沒有錯**。
 *
 * #310 修的是同一族的另一個：停課在昨天以前被排除、在今天被算進去，
 * 兩段規則不一致而測試全綠 —— 因為沒有人把它們並排看過。
 */
describe('未點名卡：兩段的分類必須一致', () => {
  const cases = [
    { what: '沒點名且已上完', row: session({ takenAt: null }), expected: true },
    { what: '已經點過名', row: session({ takenAt: '2026-08-25T11:30:00Z' }), expected: false },
    { what: '停課', row: session({ status: 'cancelled', takenAt: null }), expected: false },
  ];

  for (const { what, row, expected } of cases) {
    it(`${what} → 前端算 ${expected ? '' : '不'}算未點名（API 側同答案）`, () => {
      assertSameClassification(row, expected);
    });
  }

  /**
   * 前端的分類。API 側對同一堂課的答案寫在上面的對照表裡 ——
   * **這個 helper 存在是為了讓下一個改任一側的人看到那張表。**
   */
  function assertSameClassification(row: EventSessionSummary, expected: boolean) {
    expect(countUntakenSessions([row], 'per_session', NOON)).toBe(expected ? 1 : 0);
  }

  // 這一條守的是那個藏在參數裡的前提。它跟 dashboard.component.spec 的
  // 「回溯那支只查到昨天」是同一件事的兩端：那邊驗參數，這邊說明為什麼那個參數重要。
  it('還沒上完的課前端不算 —— 而 API 側沒有這個條件，它靠「只查到昨天」', () => {
    // NOON 是 08-29 中午，所以這堂是「今天稍晚」的課
    const notYetEnded = session({
      eventDate: '2026-08-29',
      startTime: '14:00',
      endTime: '16:00',
      takenAt: null,
    });

    expect(countUntakenSessions([notYetEnded], 'per_session', NOON)).toBe(0);
  });
});
