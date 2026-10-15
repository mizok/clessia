/**
 * 得分率（100 分制）。跨場比較（總覽平均、排序、進退步）一律走這支（#1314 gate ①）。
 *
 * **總分 ≤ 0 回 null**：DB 沒有 `total_score > 0` 的約束、API 也收 0，直接除會變
 * NaN／Infinity —— 序列化成 null 讓整個摘要平均消失、排序被打亂。呼叫端拿到 null 就讓
 * 那一筆**不進平均、不進排序**。
 */
export function scorePercent(score: number, totalScore: number): number | null {
  return totalScore > 0 ? (score / totalScore) * 100 : null;
}
