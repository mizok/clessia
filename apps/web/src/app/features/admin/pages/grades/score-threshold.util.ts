/**
 * 及格門檻。
 *
 * **規格說的是「依該考試設定的及格線」**
 * （`kb/wiki/specs/admin/student-affairs/grades.md`），但 `academy_exams` /
 * `school_exams` 都**還沒有及格線欄位** —— 那支 migration 在使用者窗口排隊。
 *
 * 在那之前這裡用 **總分的 60%**，而不是寫死的 60 分：
 * - 總分 100 時 `100 * 0.6 = 60`，**行為跟原本一模一樣**
 * - 總分 50 的小考，原本會把**滿分的人標成不及格**（`total_score` 預設 100
 *   但可以是 0~9999，見 `routes/academy-exams.ts`）
 *
 * 它仍然是猜的，但它是「不改變既有行為、只消滅明顯錯誤」的那種猜法。
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
 * **第 1 層是為了「及格線成為考試欄位」那條線先開的路。** 欄位還沒生出來時
 * 呼叫端不傳它，行為跟以前**完全一樣** —— 加法優先：先把新路接上，再移除舊的。
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
