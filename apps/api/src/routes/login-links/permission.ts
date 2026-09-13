import type { Permission } from '../../lib/permissions';

/**
 * 替某個對象產生登入連結，需要哪些權限（#464）。
 *
 * **登入連結就是憑證** —— 拿到就能登入。這支端點原本只有 `ADMIN_ONLY` 的角色檢查，
 * 於是一個只有 `basic_operations` 的行政可以替**任何人**產生連結，包含總管理員。
 *
 * 計畫席的裁決是**依對象分**：家長 → `manage_students`、職員 → `manage_staff`。
 * 規則住在這裡而不是 `mount()` 上，理由逐字是「**route 層讀不到 body 的對象，
 * 掛單一權限不是太鬆就是太緊**」。
 */
export function requiredPermissionsForTarget(targetRoles: readonly string[]): Permission[] {
  const required = new Set<Permission>();

  if (targetRoles.includes('parent')) {
    required.add('manage_students');
  }
  if (targetRoles.includes('admin') || targetRoles.includes('teacher')) {
    required.add('manage_staff');
  }

  /**
   * **不認得的角色（含空陣列）不能回空陣列。**
   *
   * 呼叫端會用「每一項都有」來判斷，而空集合對 `every()` 恆真 —— 那是 fail-open，
   * 在一支產生憑證的端點上是最不能接受的失效方向。
   *
   * 回一個現有詞彙裡最嚴的那個（`manage_roles` 是「能調整他人權限」），
   * 等於「除非你本來就能提權，否則這條路走不通」。**不新造權限名**（裁決的原則）。
   */
  if (required.size === 0) {
    required.add('manage_roles');
  }

  return [...required];
}
