import { PASSING_RATIO, PASSING_SCORE, isFailingScore } from './score-threshold.util';

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

  describe('按總分的比例', () => {
    // 總分 100 時 100 * 0.6 = 60 —— 跟原本寫死的門檻一模一樣
    it('總分 100 時行為跟舊的完全相同', () => {
      expect(isFailingScore(59, 100)).toBe(true);
      expect(isFailingScore(60, 100)).toBe(false);
    });

    // 原本一場總分 50 的小考會把滿分的人標成不及格
    it('總分 50 的小考，滿分不是不及格', () => {
      expect(isFailingScore(50, 50)).toBe(false);
    });

    it('總分 50 的小考，29 分是不及格（門檻 30）', () => {
      expect(isFailingScore(29, 50)).toBe(true);
      expect(isFailingScore(30, 50)).toBe(false);
    });

    it('總分 200 時門檻是 120', () => {
      expect(isFailingScore(119, 200)).toBe(true);
      expect(isFailingScore(120, 200)).toBe(false);
    });

    it('比例常數就是 0.6', () => {
      expect(PASSING_RATIO).toBe(0.6);
      expect(100 * PASSING_RATIO).toBe(PASSING_SCORE);
    });
  });

  describe('拿不到總分時退回 60', () => {
    it('沒傳總分', () => {
      expect(isFailingScore(59)).toBe(true);
      expect(isFailingScore(60)).toBe(false);
    });

    it('總分是 null', () => {
      expect(isFailingScore(59, null)).toBe(true);
    });

    // 總分 0 除下去門檻會是 0，那會讓所有分數都及格 —— 比退回 60 更糟
    it('總分 0 不拿來當基準', () => {
      expect(isFailingScore(0, 0)).toBe(true);
    });
  });
});
