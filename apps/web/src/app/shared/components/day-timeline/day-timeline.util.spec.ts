import type { EventSessionSummary } from '@core/attendance.service';
import {
  BIN_MINUTES,
  DEFAULT_END_HOUR,
  DEFAULT_START_HOUR,
  axisTicks,
  binDay,
  deriveWindow,
  nowMarkerPct,
  parseTimeToHours,
} from './day-timeline.util';

/** 只填時間相關欄位，其餘用不到的補上最小值 */
function session(
  startTime: string | null,
  endTime: string | null,
  id = startTime ?? 'x',
  takenAt: string | null = null,
) {
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
    takenAt,
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

/**
 * bin 計數取代了原本的 lane 分配。
 *
 * **改畫法的理由是高度**：lane 式佈局每多一條就高 30px，密集日把主入口推到摺線下 ——
 * 課越多這張圖越擋路，而課多正是最需要往下看的日子。密度圖的高度與課量脫鉤。
 * 見 kb/wiki/architecture/timeline-density.md。
 */
describe('binDay —— 每半小時一根', () => {
  it('預設視窗切成 28 根（08–22，每半小時）', () => {
    const { bins } = binDay([]);

    expect(BIN_MINUTES).toBe(30);
    expect(bins).toHaveLength((DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 2);
    expect(bins[0].startHour).toBe(DEFAULT_START_HOUR);
    expect(bins[1].startHour).toBe(DEFAULT_START_HOUR + 0.5);
  });

  it('沒有課時每一根都是 0，最大值也是 0', () => {
    const { bins, maxTotal } = binDay([]);

    expect(bins.every((bin) => bin.total === 0)).toBe(true);
    expect(maxTotal).toBe(0);
  });

  // 這一條是「涵蓋」與「開始」的分界：用開始計數的話，一整天的長課只會出現在一根，
  // 圖就變成「開課時刻分佈」而不是「忙碌程度」
  it('90 分鐘的課跨三根，每一根都算到它', () => {
    const { bins } = binDay([session('09:00', '10:30')]);
    const at = (hour: number) => bins.find((bin) => bin.startHour === hour)!.total;

    expect(at(9)).toBe(1);
    expect(at(9.5)).toBe(1);
    expect(at(10)).toBe(1);
    expect(at(10.5)).toBe(0);
  });

  // 半開區間：接續不是重疊
  it('09:00–10:00 的課不算進 10:00 那一根', () => {
    const { bins } = binDay([session('09:00', '10:00')]);

    expect(bins.find((bin) => bin.startHour === 9.5)!.total).toBe(1);
    expect(bins.find((bin) => bin.startHour === 10)!.total).toBe(0);
  });

  it('同時段的課疊加成一根的高度', () => {
    const { bins, maxTotal } = binDay([
      session('09:00', '12:00', 'a'),
      session('09:30', '12:00', 'b'),
      session('10:00', '12:00', 'c'),
    ]);

    expect(bins.find((bin) => bin.startHour === 9)!.total).toBe(1);
    expect(bins.find((bin) => bin.startHour === 9.5)!.total).toBe(2);
    expect(bins.find((bin) => bin.startHour === 10)!.total).toBe(3);
    expect(maxTotal).toBe(3);
  });

  it('未點名分開計，總數不變', () => {
    const { bins } = binDay([
      session('09:00', '10:00', 'a', '2026-09-03T01:00:00Z'),
      session('09:00', '10:00', 'b'),
    ]);
    const nine = bins.find((bin) => bin.startHour === 9)!;

    expect(nine.total).toBe(2);
    expect(nine.untaken).toBe(1);
  });

  // 給它一個預設時長等於憑空宣稱一段我們沒有的資訊
  it('有起無迄只算起始那一根', () => {
    const { bins } = binDay([session('09:00', null)]);

    expect(bins.find((bin) => bin.startHour === 9)!.total).toBe(1);
    expect(bins.find((bin) => bin.startHour === 9.5)!.total).toBe(0);
  });

  it('結束早於開始（壞資料）也只算起始那一根', () => {
    const { bins } = binDay([session('09:00', '08:00')]);

    expect(bins.find((bin) => bin.startHour === 9)!.total).toBe(1);
    expect(bins.filter((bin) => bin.total > 0)).toHaveLength(1);
  });

  it('沒有開始時間的課不落任何 bin，但要出現在 unplaced 裡', () => {
    const { bins, unplaced } = binDay([session(null, null, 'ghost'), session('09:00', '10:00')]);

    expect(unplaced.map((s) => s.eventId)).toEqual(['ghost']);
    expect(bins.reduce((sum, bin) => sum + bin.total, 0)).toBe(2);
  });

  it('視窗被晚課撐大時 bin 跟著增加', () => {
    const { bins, window } = binDay([session('19:00', '23:30')]);

    expect(window.endHour).toBe(24);
    expect(bins).toHaveLength((24 - DEFAULT_START_HOUR) * 2);
  });

  // 不是 30 分鐘整數倍的時間：照「涵蓋」規則，沾到的每一根都算。
  // 09:15–09:45 沾到 09:00 那一根的後半、也沾到 09:30 那一根的前半。
  it('09:15–09:45 的課涵蓋兩根', () => {
    const { bins } = binDay([session('09:15', '09:45')]);

    expect(bins.find((bin) => bin.startHour === 9)!.total).toBe(1);
    expect(bins.find((bin) => bin.startHour === 9.5)!.total).toBe(1);
    expect(bins.find((bin) => bin.startHour === 10)!.total).toBe(0);
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
