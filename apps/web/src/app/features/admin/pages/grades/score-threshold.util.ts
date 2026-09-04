/**
 * 及格門檻 —— 目前**寫死 60 分**，而那跟規格對不上。
 *
 * `kb/wiki/specs/admin/student-affairs/grades.md` 說「及格/不及格用顏色區分
 * （**依該考試設定的及格線**）」，但 `academy_exams` / `school_exams` 都**沒有
 * 及格線欄位**（API schema 與 migration 都查過，2026-09-04）—— 所以那句規格
 * 還沒有實作，`60` 是它的佔位。
 *
 * **這在總分不是 100 的考試上會出錯**：`total_score` 預設 100 但可以是 0~9999
 * （`routes/academy-exams.ts` 的 `body.totalScore ?? 100`），一場總分 50 的小考
 * 會讓**滿分的人也被標成不及格**。
 *
 * 抽成這裡不是為了改行為（行為一模一樣），是為了**讓那個判斷有一個可以修的地方** ——
 * 它原本以 `score < 60` 的字面值散在 11 處模板裡，及格線真的變成考試設定時，
 * 那會是一次散彈式修改，而且模板裡的字面值沒有任何 gate 看得到。
 */
export const PASSING_SCORE = 60;

/**
 * 這個分數算不算不及格。
 *
 * **`null` 不算** —— 那是「還沒登錄」或「缺考」，不是考差了。把沒有分數的人
 * 標成不及格，跟把還沒點名的人標成缺席是同一種錯（見 kb 的
 * `empty-array-hides-loading` 那一族）。
 */
export function isFailingScore(score: number | null | undefined): boolean {
  return score !== null && score !== undefined && score < PASSING_SCORE;
}
