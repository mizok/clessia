/**
 * 不及格判準（#1314 G5／G6）。**web `shared/utils/score-threshold.util.ts` 的同一條**，
 * 彙總要在伺服器數所以搬一份過來。兩份由 `score-threshold.spec.ts` 用同一張 fixture
 * 表**同時**驗（spec 直接 import web 那份）—— 改一邊沒改另一邊就紅。
 *
 * 三層退路：`passScore`（0 有效）→ `totalScore × 0.6`（總分 > 0）→ 60。
 * `null`／`undefined`＝沒分數（未登、缺考），不算不及格。
 *
 * ponytail: 兩份，升級路徑＝搬進 packages 並接好別名（兩邊 tsconfig＋Workers 打包都要接；
 * `packages/validators` 目前沒人引用、別名沒驗過）。
 */
export const PASSING_RATIO = 0.6;
export const PASSING_SCORE = 60;

export interface ScoreThreshold {
  passScore?: number | null;
  totalScore?: number | null;
}

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
