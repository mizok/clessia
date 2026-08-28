/**
 * 這個帳號現在還能不能用。
 *
 * 判斷依據是 `staff` 與 `parents` 兩張表的 `status` —— 一個人可以同時是老師和家長，
 * **只要還有一個身分是 active 就放行**。
 *
 * ⚠️ **沒有任何身分列 ≠ 被停用。** bootstrap 建的第一個管理員在兩張表裡都沒有列，
 * 擋掉的話他永遠進不去自己的站。這條最容易寫錯。
 *
 * 其餘一律 fail-closed：未知的狀態值當成不可用。
 *
 * 這個檢查原本住在 `POST /api/login` 裡（登入時擋一次）。那支端點在 PR #24 隨密碼登入
 * 一起被刪除，而**檢查沒有搬家** —— 被停用的家長只要還握著 LINE 綁定或未過期的
 * 一次性連結就能繼續進系統。現在改在 `authMiddleware`，**每個請求都檢查**，
 * 所以停用是立即生效的，不必等 session 過期。
 */
export function isAccountUsable(statuses: readonly string[]): boolean {
  if (statuses.length === 0) {
    return true;
  }

  return statuses.some((status) => status === 'active');
}
