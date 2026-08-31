import type { EventSessionSummary } from '@core/attendance.service';
import {
  DEFAULT_END_HOUR,
  DEFAULT_START_HOUR,
  POINT_WIDTH_PCT,
  axisTicks,
  deriveWindow,
  layoutDay,
  nowMarkerPct,
  parseTimeToHours,
} from './day-timeline.util';

/** 只填時間相關欄位，其餘用不到的補上最小值 */
function session(startTime: string | null, endTime: string | null, id = startTime ?? 'x') {
  return {
    eventId: id,
    sessionId: id,
    status: 'scheduled',
    isSubstitute: false,
    examCount: 0,
    classId: 'c',
    className: '班',
    courseName: null,
    teacherName: null,
    campusId: null,
    campusName: null,
    eventDate: '2026-08-30',
    startTime,
    endTime,
    enrolledCount: 0,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
  } satisfies EventSessionSummary;
}

describe('parseTimeToHours', () => {
  it('讀得懂 HH:mm 與帶秒的形式', () => {
    expect(parseTimeToHours('09:00')).toBe(9);
    expect(parseTimeToHours('09:30')).toBe(9.5);
    expect(parseTimeToHours('9:15')).toBe(9.25);
    expect(parseTimeToHours('13:45:00')).toBe(13.75);
  });

  // 資料來自 API，格式壞掉時要回 null 讓呼叫端當成「沒有時間」，不是丟例外炸掉整頁
  it('壞資料回 null 而不是丟例外', () => {
    expect(parseTimeToHours(null)).toBeNull();
    expect(parseTimeToHours('')).toBeNull();
    expect(parseTimeToHours('午休')).toBeNull();
    expect(parseTimeToHours('25:00')).toBeNull();
    expect(parseTimeToHours('09:75')).toBeNull();
  });
});

describe('deriveWindow —— 只擴不縮', () => {
  it('沒有課時是預設視窗', () => {
    expect(deriveWindow([])).toEqual({
      startHour: DEFAULT_START_HOUR,
      endHour: DEFAULT_END_HOUR,
    });
  });

  // 這一條是整個設計的重點：縮視窗會讓「只有一堂晚課」看起來像排滿了
  it('只有一堂晚課時，軸仍然是完整的一天', () => {
    const win = deriveWindow([session('19:00', '21:00')]);
    expect(win).toEqual({ startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR });
  });

  it('早於預設起點的課會把視窗往前擴', () => {
    expect(deriveWindow([session('07:30', '09:00')]).startHour).toBe(7);
  });

  it('晚於預設終點的課會把視窗往後擴', () => {
    expect(deriveWindow([session('21:00', '23:30')]).endHour).toBe(24);
  });

  it('沒有結束時間時用開始時間決定是否要擴', () => {
    expect(deriveWindow([session('23:00', null)]).endHour).toBe(23);
  });

  it('結束時間早於開始時間（壞資料）不會把視窗縮回去', () => {
    const win = deriveWindow([session('20:00', '08:00')]);
    expect(win.startHour).toBe(DEFAULT_START_HOUR);
    expect(win.endHour).toBe(DEFAULT_END_HOUR);
  });
});

describe('layoutDay —— lane 分配', () => {
  it('不重疊的課全部在同一條 lane', () => {
    const { lanes } = layoutDay([
      session('09:00', '10:00'),
      session('10:00', '11:00'),
      session('14:00', '16:00'),
    ]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toHaveLength(3);
  });

  it('兩堂重疊會分成兩條 lane', () => {
    const { lanes } = layoutDay([session('09:00', '11:00'), session('10:00', '12:00')]);
    expect(lanes).toHaveLength(2);
  });

  // 樸素的「跟前一堂比」在三堂以上會塌掉 —— 這一條就是為了盯住它
  it('三堂同時開課會分成三條 lane', () => {
    const { lanes } = layoutDay([
      session('09:00', '12:00', 'a'),
      session('09:30', '12:00', 'b'),
      session('10:00', '12:00', 'c'),
    ]);
    expect(lanes).toHaveLength(3);
    expect(lanes.flat()).toHaveLength(3);
  });

  it('lane 會被重複使用 —— 前一堂結束後的課回到第一條', () => {
    const { lanes } = layoutDay([
      session('09:00', '11:00', 'a'),
      session('09:30', '10:30', 'b'),
      session('11:00', '12:00', 'c'),
    ]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((p) => p.session.eventId)).toEqual(['a', 'c']);
    expect(lanes[1].map((p) => p.session.eventId)).toEqual(['b']);
  });

  it('輸入沒有排序也能正確分配', () => {
    const { lanes } = layoutDay([
      session('14:00', '15:00', 'late'),
      session('09:00', '10:00', 'early'),
    ]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].map((p) => p.session.eventId)).toEqual(['early', 'late']);
  });

  it('剛好接續（前一堂結束＝後一堂開始）不算重疊', () => {
    const { lanes } = layoutDay([session('09:00', '10:00'), session('10:00', '11:00')]);
    expect(lanes).toHaveLength(1);
  });
});

describe('layoutDay —— 位置與缺時間的處理', () => {
  it('位置是相對視窗的百分比', () => {
    const { lanes } = layoutDay([session('08:00', '22:00')]);
    expect(lanes[0][0].leftPct).toBe(0);
    expect(lanes[0][0].widthPct).toBe(100);
  });

  it('中午的課落在軸的中間', () => {
    const { lanes } = layoutDay([session('15:00', '15:00')]);
    // 視窗 08–22，15:00 是第 7 小時 / 共 14 小時
    expect(lanes[0][0].leftPct).toBeCloseTo(50, 5);
  });

  // 給沒有結束時間的課一個預設時長，等於憑空宣稱一段我們沒有的資訊
  it('有起無迄畫成點，不是有長度的方塊', () => {
    const { lanes } = layoutDay([session('09:00', null)]);
    expect(lanes[0][0].isPoint).toBe(true);
    expect(lanes[0][0].widthPct).toBe(POINT_WIDTH_PCT);
  });

  it('兩個相鄰的點不會疊在同一條 lane 的同一個位置', () => {
    const { lanes } = layoutDay([session('09:00', null, 'a'), session('09:00', null, 'b')]);
    expect(lanes).toHaveLength(2);
  });

  it('沒有開始時間的課不畫，但要出現在 unplaced 裡', () => {
    const { lanes, unplaced } = layoutDay([
      session(null, null, 'ghost'),
      session('09:00', '10:00'),
    ]);
    expect(lanes.flat()).toHaveLength(1);
    expect(unplaced.map((s) => s.eventId)).toEqual(['ghost']);
  });

  it('全部都沒有時間時，沒有 lane 但全部進 unplaced', () => {
    const { lanes, unplaced } = layoutDay([session(null, null, 'a'), session(null, null, 'b')]);
    expect(lanes).toHaveLength(0);
    expect(unplaced).toHaveLength(2);
  });

  it('沒有課時不會炸', () => {
    const layout = layoutDay([]);
    expect(layout.lanes).toHaveLength(0);
    expect(layout.unplaced).toHaveLength(0);
  });
});

describe('nowMarkerPct', () => {
  const win = { startHour: 8, endHour: 22 };

  it('今天而且在視窗內才有位置', () => {
    const now = new Date(2026, 7, 30, 15, 0);
    expect(nowMarkerPct(win, '2026-08-30', now)).toBeCloseTo(50, 5);
  });

  // 看昨天的軸上畫一條「現在」是假資訊
  it('不是今天就沒有標記', () => {
    expect(nowMarkerPct(win, '2026-08-29', new Date(2026, 7, 30, 15, 0))).toBeNull();
  });

  it('現在落在視窗外就沒有標記', () => {
    expect(nowMarkerPct(win, '2026-08-30', new Date(2026, 7, 30, 6, 0))).toBeNull();
    expect(nowMarkerPct(win, '2026-08-30', new Date(2026, 7, 30, 23, 0))).toBeNull();
  });

  // 用本地時間比對而不是 toISOString —— 補習班的「今天」是本地的今天，
  // UTC+8 的凌晨會跟 UTC 差一天（既有 spec 踩過這個坑）
  it('用本地日期比對，不是 UTC', () => {
    const earlyMorning = new Date(2026, 7, 30, 8, 30);
    expect(nowMarkerPct(win, '2026-08-30', earlyMorning)).not.toBeNull();
  });
});

describe('axisTicks', () => {
  it('預設視窗給每兩小時一個刻度', () => {
    expect(axisTicks({ startHour: 8, endHour: 22 })).toEqual([8, 10, 12, 14, 16, 18, 20, 22]);
  });

  it('視窗被撐大時刻度不會擠成一團', () => {
    expect(axisTicks({ startHour: 6, endHour: 24 }).length).toBeLessThanOrEqual(8);
  });

  it('很短的視窗給每小時一個刻度', () => {
    expect(axisTicks({ startHour: 8, endHour: 14 })).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });
});
