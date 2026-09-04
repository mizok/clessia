import { PASSING_SCORE, isFailingScore } from './score-threshold.util';

describe('isFailingScore', () => {
  it('低於門檻是不及格', () => {
    expect(isFailingScore(59)).toBe(true);
  });

  it('剛好門檻算及格', () => {
    expect(isFailingScore(PASSING_SCORE)).toBe(false);
  });

  it('高於門檻是及格', () => {
    expect(isFailingScore(100)).toBe(false);
  });

  // 沒有分數不是考差了 —— 把還沒登錄的標成不及格，跟把還沒點名的標成缺席是同一種錯
  it('還沒登錄（null）不算不及格', () => {
    expect(isFailingScore(null)).toBe(false);
  });

  it('undefined 也不算', () => {
    expect(isFailingScore(undefined)).toBe(false);
  });

  // 0 分是真的考了 0 分，跟沒登錄不一樣
  it('0 分算不及格 —— 它是一個真的分數', () => {
    expect(isFailingScore(0)).toBe(true);
  });
});
