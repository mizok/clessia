import { describe, expect, it } from 'vitest';

import { hasSessionEndedByNow } from './session-end-time';

/**
 * 案例逐一照抄 `apps/web/src/app/shared/utils/session-time.util.spec.ts` 的
 * `hasSessionEnded` 那組——兩邊對同一個概念的判定必須逐案一致，這正是這支
 * 函式要解的漂移問題本身：如果搬過來的案例集合對不齊，等於製造了第二種漂移。
 *
 * **跟前端測試的差異只有一點**：`now` 一律用顯式 `+08:00` offset 建構，不用
 * 裸的 `new Date('2026-08-30T12:00:00')`——後者的解讀取決於跑測試的機器時區，
 * 前端測試在瀏覽器環境裡這樣寫沒問題（跟函式內部同一個「本地時區」），但這支
 * 函式刻意假設台灣時間跟 runtime 時區無關，用裸時間字串測會讓測試本身變得
 * 不確定（CI 機器在 UTC，本機在 UTC+8，同一份測試在兩邊可能得到不同答案）。
 */
function session(
  overrides: Partial<{ date: string; startTime: string | null; endTime: string | null }> = {},
) {
  return { date: '2026-08-30', startTime: '09:00', endTime: '11:00', ...overrides };
}

/** 2026-08-30 中午（台北時間） */
const NOON = new Date('2026-08-30T12:00:00+08:00');

describe('hasSessionEndedByNow', () => {
  it('今天早上上完的課算結束', () => {
    expect(hasSessionEndedByNow(session(), NOON)).toBe(true);
  });

  // 這是這個函式存在的理由：晚上的課從一早就被標成「漏點名」是誤報
  it('今天晚上還沒上的課不算結束', () => {
    expect(hasSessionEndedByNow(session({ startTime: '19:00', endTime: '21:00' }), NOON)).toBe(
      false,
    );
  });

  it('剛好結束在此刻算結束', () => {
    expect(hasSessionEndedByNow(session({ startTime: '10:00', endTime: '12:00' }), NOON)).toBe(
      true,
    );
  });

  it('昨天的課算結束', () => {
    expect(hasSessionEndedByNow(session({ date: '2026-08-29', endTime: '21:00' }), NOON)).toBe(
      true,
    );
  });

  it('明天的課不算結束', () => {
    expect(hasSessionEndedByNow(session({ date: '2026-08-31', endTime: '09:00' }), NOON)).toBe(
      false,
    );
  });

  describe('沒有結束時間', () => {
    it('今天的課在當天內不算結束', () => {
      expect(hasSessionEndedByNow(session({ endTime: null }), NOON)).toBe(false);
    });

    it('今天的課在當天結束前都不算結束', () => {
      const almostMidnight = new Date('2026-08-30T23:59:00+08:00');

      expect(hasSessionEndedByNow(session({ endTime: null }), almostMidnight)).toBe(false);
    });

    // 但這一天過完之後就一定上完了 —— 永遠回 false 會讓沒填時間的課永遠不被追
    it('隔天就算結束', () => {
      const nextDay = new Date('2026-08-31T00:00:00+08:00');

      expect(hasSessionEndedByNow(session({ endTime: null }), nextDay)).toBe(true);
    });

    it('startTime 也沒有時同樣按整天算', () => {
      expect(hasSessionEndedByNow(session({ startTime: null, endTime: null }), NOON)).toBe(false);
    });
  });

  describe('跨午夜的課', () => {
    it('23:00–01:00 的課在當天午夜前不算結束', () => {
      const beforeMidnight = new Date('2026-08-30T23:30:00+08:00');

      expect(
        hasSessionEndedByNow(session({ startTime: '23:00', endTime: '01:00' }), beforeMidnight),
      ).toBe(false);
    });

    it('23:00–01:00 的課在隔天凌晨兩點算結束', () => {
      const nextMorning = new Date('2026-08-31T02:00:00+08:00');

      expect(
        hasSessionEndedByNow(session({ startTime: '23:00', endTime: '01:00' }), nextMorning),
      ).toBe(true);
    });
  });

  // 這支只認 UTC+8 的絕對時刻，不吃 runtime 的本地時區 —— 用一個跟 +08:00
  // 换算後不同「牆上時鐘」但同一個瞬間的 UTC 字串驗證
  it('跟 runtime 的本地時區無關，只看絕對時刻', () => {
    const noonInUtc = new Date('2026-08-30T04:00:00Z'); // 等於台北時間 12:00

    expect(hasSessionEndedByNow(session(), noonInUtc)).toBe(hasSessionEndedByNow(session(), NOON));
  });
});
