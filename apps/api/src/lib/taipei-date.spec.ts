import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysToDateString, getCurrentTaipeiDateString } from './taipei-date';

/**
 * P0-1（2026-09-06）：`leaves.ts` 用 `new Date().toISOString().slice(0, 10)`
 * 算「今天」，在台北時間 00:00–08:00 之間會算成前一天，main 因此紅了一整晚。
 * 那條 bug 活到今天的原因是**沒有人在台北凌晨跑過 CI**——一天有 8 小時是錯的，
 * 但從來沒有測試在那個窗口內驗證過。
 *
 * 這裡直接測 `getCurrentTaipeiDateString()` 本身在那個窗口的行為，是因為
 * 所有依賴它的呼叫端（`leaves.ts` / `invoices.ts` / `billing-runs.ts` /
 * `session-packs.ts` ……）都只是把「今天」轉手用掉，真正會出錯的判斷只有一處：
 * 這支函式有沒有正確地認台北，不是 UTC。**測這一支，涵蓋全部呼叫端**，
 * 不用在每個呼叫端各自重測一次「今天怎麼算」。
 */
describe('getCurrentTaipeiDateString —— 台北凌晨那個窗', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('UTC 還在前一天傍晚，台北已經跨到隔天凌晨 —— 要回台北的日期，不是 UTC 的', () => {
    // 台北 2026-09-06T01:00:00+08:00 = UTC 2026-09-05T17:00:00Z
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

    expect(getCurrentTaipeiDateString()).toBe('2026-09-06');
    // 對照組：naive 的 UTC 算法在這個時刻會算成前一天，這正是 #402 的根因形狀
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('剛好卡在台北跨日的那一刻（00:00:00+08:00）', () => {
    // 台北 2026-09-06T00:00:00+08:00 = UTC 2026-09-05T16:00:00Z
    vi.setSystemTime(new Date('2026-09-05T16:00:00Z'));

    expect(getCurrentTaipeiDateString()).toBe('2026-09-06');
  });

  it('台北凌晨快結束（07:59），UTC 那一側同一天不受影響時也要回台北的今天', () => {
    // 台北 2026-09-06T07:59:00+08:00 = UTC 2026-09-05T23:59:00Z
    vi.setSystemTime(new Date('2026-09-05T23:59:00Z'));

    expect(getCurrentTaipeiDateString()).toBe('2026-09-06');
  });

  it('危險窗口之外（台北下午），UTC 與台北同一天，兩邊本來就該一致', () => {
    // 台北 2026-09-06T15:00:00+08:00 = UTC 2026-09-06T07:00:00Z
    vi.setSystemTime(new Date('2026-09-06T07:00:00Z'));

    expect(getCurrentTaipeiDateString()).toBe('2026-09-06');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-06');
  });
});

describe('addDaysToDateString', () => {
  it('往前推一天（leaves.ts 的「昨天」用法）', () => {
    expect(addDaysToDateString('2026-09-05', -1)).toBe('2026-09-04');
  });

  it('往後推一天', () => {
    expect(addDaysToDateString('2026-09-05', 1)).toBe('2026-09-06');
  });

  it('跨月邊界', () => {
    expect(addDaysToDateString('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('跨年邊界', () => {
    expect(addDaysToDateString('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('days 是 0 時原樣回傳', () => {
    expect(addDaysToDateString('2026-09-05', 0)).toBe('2026-09-05');
  });
});
