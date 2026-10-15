import { describe, expect, it } from 'vitest';
import { isFailingScore } from './score-threshold';
import { isFailingScore as webIsFailingScore } from '../../../web/src/app/shared/utils/score-threshold.util';

/**
 * 兩份判準釘同一張表（#1314 gate ①）：api 與 web 各跑一次，任一邊漂走就紅。
 * 每組門檻都給 −1／門檻／+1。
 */
const FIXTURES: Array<
  [number | null, { passScore?: number | null; totalScore?: number | null }, boolean]
> = [
  // passScore 有
  [69, { passScore: 70, totalScore: 100 }, true],
  [70, { passScore: 70, totalScore: 100 }, false],
  [71, { passScore: 70, totalScore: 100 }, false],
  [0, { passScore: 0, totalScore: 100 }, false], // 0 是有效及格線
  // passScore 無、總分 100
  [59, { totalScore: 100 }, true],
  [60, { totalScore: 100 }, false],
  [61, { passScore: null, totalScore: 100 }, false],
  // 總分非 100
  [29, { totalScore: 50 }, true],
  [30, { totalScore: 50 }, false],
  [31, { totalScore: 50 }, false],
  [119, { totalScore: 200 }, true],
  [120, { totalScore: 200 }, false],
  // 拿不到總分 → 60；總分 0 不拿來當基準
  [59, {}, true],
  [60, {}, false],
  [0, { totalScore: 0 }, true],
  // 沒分數不是不及格
  [null, { passScore: 70 }, false],
];

describe('isFailingScore（api 與 web 同一張表）', () => {
  for (const [score, threshold, expected] of FIXTURES) {
    it(`${score} ${JSON.stringify(threshold)} → ${expected}`, () => {
      expect(isFailingScore(score, threshold)).toBe(expected);
      expect(webIsFailingScore(score, threshold)).toBe(expected);
    });
  }
});
