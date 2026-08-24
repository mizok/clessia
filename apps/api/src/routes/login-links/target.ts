export interface LoginLinkTarget {
  /** `ba_user.orgId`。欄位是 nullable —— 由 app 建立但還沒指派組織的使用者會是 null */
  readonly orgId: string | null;
  readonly roles: readonly string[];
}

export type LoginLinkDecision =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'NO_ROLES'; status: 404 | 422 };

/**
 * 誰可以替誰產生登入連結。**這支端點唯一重要的問題。**
 *
 * 登入連結就是帳號 —— 拿到就能登入。所以跨組織必須是硬性禁止（憲法 c1：授權發生在
 * API 層，靠 org_id 過濾），而且**回傳與「找不到」完全一樣的結果**：不同的錯誤碼會
 * 讓人問出「B 補習班有沒有這個使用者」。
 *
 * `orgId` 兩邊都是 nullable，所以**不能用 `===` 直接比** —— `null === null` 會讓兩個
 * 都沒有組織的使用者互相通過。缺任何一邊一律拒絕。
 */
export function decideLoginLinkTarget(
  target: LoginLinkTarget | null,
  callerOrgId: string
): LoginLinkDecision {
  const notFound = { ok: false, code: 'NOT_FOUND', status: 404 } as const;

  if (!target || !callerOrgId || !target.orgId) {
    return notFound;
  }

  if (target.orgId !== callerOrgId) {
    return notFound;
  }

  if (target.roles.length === 0) {
    // 這一條可以透露細節：呼叫端已經證明自己看得到這個組織裡的這個人
    return { ok: false, code: 'NO_ROLES', status: 422 };
  }

  return { ok: true };
}
