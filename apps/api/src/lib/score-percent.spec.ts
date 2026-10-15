import { describe, expect, it } from 'vitest';
import { scorePercent } from './score-percent';

// 路由層看不出 NaN／Infinity 跟 null 的差（JSON 都序列化成 null），所以防 0 在這裡直接釘
describe('scorePercent', () => {
  it('換算成 100 分制', () => {
    expect(scorePercent(29, 50)).toBeCloseTo(58, 10);
    expect(scorePercent(0, 100)).toBe(0);
  });

  it('總分 0 或負數回 null，不是 NaN／Infinity', () => {
    expect(scorePercent(0, 0)).toBeNull();
    expect(scorePercent(70, 0)).toBeNull();
    expect(scorePercent(10, -5)).toBeNull();
  });
});
