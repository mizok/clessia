/**
 * 前端目前選定的身分（`AuthService.activeRole`），透過 `X-Active-Role` header 帶進來。
 *
 * **只在請求指名的角色真的是這個人的角色之一時才採信** —— 沒有這層驗證的話，
 * 一個只有 teacher 角色的人送 `X-Active-Role: admin` 就能讓 `audienceFor` 之類
 * 「看 activeRole 才決定給誰看」的判斷跟著走偏。找不到或驗不過就回 `null`，
 * 呼叫端退回角色陣列的既有規則（見 kb/wiki/architecture/parent-data-scope.md 第四節）。
 */
export function resolveActiveRole(
  requestedRole: string | undefined | null,
  roles: readonly string[],
): string | null {
  if (!requestedRole) return null;

  return roles.includes(requestedRole) ? requestedRole : null;
}
