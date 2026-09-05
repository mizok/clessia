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
      expect(isFailingScore(59, { totalScore: 100 })).toBe(true);
      expect(isFailingScore(60, { totalScore: 100 })).toBe(false);
    });

    // 原本一場總分 50 的小考會把滿分的人標成不及格
    it('總分 50 的小考，滿分不是不及格', () => {
      expect(isFailingScore(50, { totalScore: 50 })).toBe(false);
    });

    it('總分 50 的小考，29 分是不及格（門檻 30）', () => {
      expect(isFailingScore(29, { totalScore: 50 })).toBe(true);
      expect(isFailingScore(30, { totalScore: 50 })).toBe(false);
    });

    it('總分 200 時門檻是 120', () => {
      expect(isFailingScore(119, { totalScore: 200 })).toBe(true);
      expect(isFailingScore(120, { totalScore: 200 })).toBe(false);
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
      expect(isFailingScore(59, { totalScore: null })).toBe(true);
    });

    // 總分 0 除下去門檻會是 0，那會讓所有分數都及格 —— 比退回 60 更糟
    it('總分 0 不拿來當基準', () => {
      expect(isFailingScore(0, { totalScore: 0 })).toBe(true);
    });
  });

  // 及格線成為考試欄位之後，它是唯一不用猜的來源 —— 比例只是它缺席時的退路
  describe('該場考試設定的及格線優先', () => {
    it('有及格線就用它，不管總分是多少', () => {
      expect(isFailingScore(69, { passScore: 70, totalScore: 100 })).toBe(true);
      expect(isFailingScore(70, { passScore: 70, totalScore: 100 })).toBe(false);
    });

    // 補習班常見：滿分 100 但門檻設 70（比例算出來是 60）
    it('及格線跟比例衝突時聽及格線的', () => {
      expect(isFailingScore(65, { passScore: 70, totalScore: 100 })).toBe(true);
      expect(isFailingScore(65, { totalScore: 100 })).toBe(false);
    });

    it('及格線是 0 也算數 —— 那是「不當人」不是「沒設定」', () => {
      expect(isFailingScore(0, { passScore: 0, totalScore: 100 })).toBe(false);
    });

    it('沒有及格線就退回總分的比例', () => {
      expect(isFailingScore(29, { totalScore: 50 })).toBe(true);
      expect(isFailingScore(30, { totalScore: 50 })).toBe(false);
    });

    it('兩個都沒有就退回 60 —— 欄位還沒生出來時的行為完全不變', () => {
      expect(isFailingScore(59, {})).toBe(true);
      expect(isFailingScore(60, {})).toBe(false);
      expect(isFailingScore(59)).toBe(true);
    });

    it('沒有分數時仍然不算不及格', () => {
      expect(isFailingScore(null, { passScore: 70 })).toBe(false);
    });
  });
});
