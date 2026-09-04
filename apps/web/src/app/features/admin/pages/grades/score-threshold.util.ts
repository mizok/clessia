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
 * 這個分數算不算不及格。
 *
 * **`totalScore` 是選填的，而「沒傳」有兩種意思**（都退回 60，但原因不同）：
 *
 * 1. **拿不到** —— `class-scores-dialog` 與 `score-edit-dialog` 的列上目前沒有
 *    總分欄位。它們拿得到之後傳進來就自動修好，**這是待補的**。
 * 2. **本質上沒有** —— 科目平均（`academyAvg` / `schoolAvg`）是**跨考試的原始分數
 *    算術平均**（`routes/scores.ts` 的 `averageOrNull`，沒有百分比化），所以它
 *    根本沒有共同的總分可言。那是另一個問題（平均值本身在總分不一致時就沒有意義），
 *    **不是這裡少傳一個參數**。
 *
 * **`null` 不算不及格** —— 那是「還沒登錄」或「缺考」，不是考差了。把沒有分數的人
 * 標成不及格，跟把還沒點名的人標成缺席是同一種錯。
 */
export function isFailingScore(
  score: number | null | undefined,
  totalScore?: number | null,
): boolean {
  if (score === null || score === undefined) return false;
  const threshold =
    totalScore !== null && totalScore !== undefined && totalScore > 0
      ? totalScore * PASSING_RATIO
      : PASSING_SCORE;
  return score < threshold;
}
