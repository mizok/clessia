/**
 * 細部權限的唯一詞彙表（`user_roles.permissions` 的值）。
 *
 * **這裡是清單的家，不是 `routes/staff.ts`。** 它原本長在那支路由的 zod schema 裡，
 * 於是「有哪些權限」跟「怎麼建員工」綁在一起 —— 而問「這個權限有沒有真的擋住什麼」
 * 的人不會去那裡找。
 *
 * 每一個值都必須至少被 `index.ts` 的一個 `mount()` 使用，由 harness gate 守
 * （見 kb/wiki/architecture/authorization-scope.md 的洞 2）。**沒有 mount 用到的權限
 * 等於只擋前端，直接打 API 就繞過去了。**
 */
export const PERMISSIONS = [
  'basic_operations',
  'manage_courses',
  'manage_students',
  'manage_finance',
  'manage_staff',
  'manage_roles',
  'manage_org_settings',
  'view_reports',
  // 跨分校。**沒有它的管理員只看得到 `staff_campuses` 指派給他的分校** ——
  // 用明確的權限宣告，而不是「沒有指派列就看得到全部」那種 fail-open 的讀法。
  'all_campuses',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** `*` 通吃 —— bootstrap 建的第一個管理員拿的就是它。 */
export const WILDCARD_PERMISSION = '*';

export function hasPermission(held: readonly string[], required: string): boolean {
  return held.some((p) => p === required || p === WILDCARD_PERMISSION);
}
