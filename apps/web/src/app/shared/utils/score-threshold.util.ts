/**
 * 及格門檻。
 *
 * `academy_exams.pass_score` 已經落地（#331）——有設定就用它。這裡仍然保留
 * **總分的 60%** 當退路，因為：
 * - 沒設 `passScore` 的考試（多數既有資料）還是要有個合理門檻，不能整批不及格
 * - 家長端（`GET /api/me/grades`）目前不回 `passScore`，永遠走這一層退路——
 *   純函式本來就設計成「拿不到就退化，不是報錯」，這裡是它真的被用到退化行為的地方
 *
 * 原本移到這裡之前住在 `features/admin/pages/grades/`——家長端的成績頁也要同一套
 * 判斷，兩個 feature 共用就該放 `shared/`（c5），不要各自長一份。
 */
export const PASSING_RATIO = 0.6;

/** 拿不到總分時的退路 —— 等同 `100 * PASSING_RATIO` */
export const PASSING_SCORE = 60;

/**
 * 判斷及格與否要用到的東西。
 *
 * **用物件而不是兩個相鄰的 optional number** —— `isFailingScore(score, 100, 70)`
 * 這種簽名，傳反了不會有型別錯誤，而錯了的結果是整班被標成不及格或整班都及格。
 */
export interface ScoreThreshold {
  /**
   * 該場考試自己設定的及格線。**有它就用它** —— 那是唯一不用猜的來源。
   *
   * `0` 是有效值（「這場不當人」），所以判斷用 `!= null` 不是 truthy。
   */
  passScore?: number | null;
  /** 沒有及格線時的退路：總分的 60% */
  totalScore?: number | null;
}

/**
 * 這個分數算不算不及格。
 *
 * 三層退路，**上面有值就不看下面**：
 *
 * 1. `passScore` —— 該場考試設定的及格線
 * 2. `totalScore × 0.6` —— 沒設及格線時，用總分的比例（見上方 `PASSING_RATIO` 的說明）
 * 3. `60` —— 兩個都沒有
 *
 * **`null` 不算不及格** —— 那是「還沒登錄」或「缺考」，不是考差了。把沒有分數的人
 * 標成不及格，跟把還沒點名的人標成缺席是同一種錯。
 */
export function isFailingScore(
  score: number | null | undefined,
  threshold: ScoreThreshold = {},
): boolean {
  if (score === null || score === undefined) return false;

  const { passScore, totalScore } = threshold;
  if (passScore !== null && passScore !== undefined) return score < passScore;
  if (totalScore !== null && totalScore !== undefined && totalScore > 0) {
    return score < totalScore * PASSING_RATIO;
  }
  return score < PASSING_SCORE;
}
