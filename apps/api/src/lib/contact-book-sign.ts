/**
 * 「簽收後有修改」（#1100 #26，計畫席 10-23）：簽收保留，但內容在簽收之後又改過就標出來。
 *
 * 判準是 `updated_at > signed_at`。成立的前提有兩個，缺一個這個標記就沒有意義：
 * - 簽收時兩欄相等 —— 家長簽收走 `childDb.signContactBookEntry`，`signed_at = now()` 跟 trigger 同一個交易時間
 * - 內容沒變不寫 —— 管理端 PUT 原文照存時不 upsert，否則習慣性按儲存就讓每一筆都跳
 */
export function editedAfterSign(updatedAt: string | null, signedAt: string | null): boolean {
  if (!updatedAt || !signedAt) return false;
  return Date.parse(updatedAt) > Date.parse(signedAt);
}
