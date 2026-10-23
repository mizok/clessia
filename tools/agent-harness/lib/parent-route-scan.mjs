/**
 * A19 的判斷邏輯：`apps/api/src/routes/parent/**` 有沒有出現 `c.get('supabase')`。
 *
 * 抽成獨立函式（不是留在 check-harness.mjs 裡）是為了能寫 self-test —— 尤其是
 * 「不誤判註解」這一半：這支檔案自己的說明文字就會寫 `c.get('supabase')` 字面值
 * （解釋「不要這樣寫」），沒有這個方向的測試，下一個人改動 blankComments 的呼叫
 * 順序時很容易讓 gate 抓到自己的文件而不自知。
 */
import { blankComments } from './comments.mjs';

/** @returns {boolean} 抹白註解之後，這份原始碼是否還留有真正的 c.get('supabase') 呼叫 */
export function usesRawSupabase(source, rel) {
  return /c\.get\(\s*['"]supabase['"]\s*\)/.test(blankComments(source, rel));
}

/**
 * A19 第二條（#1986 計畫席讀 diff，10-23）：家長端檔案也不得拿原始 pg 連線 —— `getAuth(` 或 `.pool`。
 * pool 跟原始 supabase 一樣沒綁 scope；要用 pool 的家長端寫入一律做成 `childDb` 的能力
 * （`createChildDb` 收 pool，見 `createLeave`、`signContactBookEntry`）。
 * @returns {boolean} 抹白註解之後，是否還有 `getAuth(` 或 `.pool` 存取
 */
export function usesRawPool(source, rel) {
  return /\bgetAuth\s*\(|\.pool\b/.test(blankComments(source, rel));
}
