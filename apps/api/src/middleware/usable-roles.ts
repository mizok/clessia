/**
 * 這個人**現在**能用哪些角色（#1846）。
 *
 * `isAccountUsable` 只回答「能不能登入」：任一身分（staff／parents）是 active 就放行。
 * 但登入之後的角色原本直接取自 `user_roles`，不看對應身分的狀態 —— 一位被停用的老師只要還有
 * active 的家長資料，就仍然切得到老師（或管理員）身分、讀寫老師端（10-22 本機重現）。
 *
 * 規則：
 * - `admin`／`teacher`／`kiosk` 跟著 **staff 列**（機台也是 staff 列，#1127）；`parent` 跟著 **parents 列**
 * - **列存在、而且沒有一列是 active**，才拿掉那一類角色。**沒有列不算停用** ——
 *   bootstrap 建的第一個管理員在兩張表都沒有列（同 `account-status.ts` 那條最容易寫錯的規則）
 * - 不認識的角色、未知的狀態值一律 fail-closed
 *
 * 權限（`user_roles.permissions`）跟著角色列走，所以拿掉 admin 也就拿掉了它的權限。
 * 呼叫端在每個請求算（輸入是 30 秒快取裡的原始列，含 status），所以停用最遲在下一次快取刷新生效。
 */

const STAFF_ROLES = new Set(['admin', 'teacher', 'kiosk']);

export function usableRoleRows<T extends { role: string }>(
  roleRows: readonly T[],
  staffRows: ReadonlyArray<{ status: string }>,
  parentRows: ReadonlyArray<{ status: string }>,
): T[] {
  const staffOk = staffRows.length === 0 || staffRows.some((r) => r.status === 'active');
  const parentOk = parentRows.length === 0 || parentRows.some((r) => r.status === 'active');
  return roleRows.filter((r) =>
    r.role === 'parent' ? parentOk : STAFF_ROLES.has(r.role) ? staffOk : false,
  );
}
