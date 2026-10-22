import { hasPermission, WILDCARD_PERMISSION } from './permissions';

/**
 * 誰可以決定別人有哪些角色與權限。
 *
 * **這件事比「管理人事資料」更高一級。** `manage_staff` 管的是姓名、電話、分校指派、
 * 停用封存；決定一個人是不是管理員、有哪些權限，是 `manage_roles`。分開的理由是
 * 提權：能建帳號的人如果同時能指定角色與權限，他就能給自己開一個權限全開的帳號。
 *
 * 所以還有第二條規則：**不能改自己的權限，有什麼權限都不行。**
 * 提權的路一定要經過另一個人。這一條連 `*` 都擋 —— 它擋的不是權限不足，
 * 是「自己批准自己」這個動作。角色的例外見 `checkSelfAssignment`（#1829）。
 *
 * 第三條（使用者 2026-10-01 裁定，#966 A2'）：**權限只能給自己有的。**
 * 只看 `manage_roles` 的話，自己沒有 `manage_finance` 的人可以建一個有它的帳號、再替它鑄
 * 登入連結，拿到自己原本沒有的權限。只有持有全部權限者（`*`）能開任何權限。
 * 這條**也約束不受分校限制的管理員** —— 它跟分校無關。
 *
 * 見 kb/wiki/architecture/authorization-scope.md 洞 3。
 */
export interface RoleAssignmentInput {
  readonly permissions: readonly string[];
  readonly requesterUserId: string;
  /** 被改的那個人的 `ba_user.id`。建立新帳號時沒有對象，傳 `null`。 */
  readonly targetUserId: string | null;
  /** 這次請求有沒有動到 roles 或 permissions */
  readonly touchesRoleAssignment: boolean;
  /**
   * 這次**新增**給對方的權限（新清單減掉對方原本的，見 `addedPermissions`）。
   * 只拿掉、或原封不動 → 空陣列：降權不是提權。
   */
  readonly grantedPermissions?: readonly string[];
  /**
   * 改自己時才看（#1829）：自己原本的角色與 admin 權限。沒給就照舊一律擋。
   * `nextRoles` / `nextPermissions` 是這次送來的；沒帶＝不動。
   */
  readonly selfPrior?: {
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
  };
  readonly nextRoles?: readonly string[];
  readonly nextPermissions?: readonly string[];
}

export type RoleAssignmentVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'self' | 'missing-permission' | 'exceeds-own';
      readonly message: string;
    };

export function checkRoleAssignment(input: RoleAssignmentInput): RoleAssignmentVerdict {
  if (!input.touchesRoleAssignment) {
    return { ok: true };
  }

  // 改自己另外判，順序在權限檢查之前 —— 自己的權限 `*` 也不能改。
  if (input.targetUserId !== null && input.targetUserId === input.requesterUserId) {
    return checkSelfAssignment(input);
  }

  if (!hasPermission(input.permissions, 'manage_roles')) {
    return {
      ok: false,
      reason: 'missing-permission',
      message: '需要「管理角色權限」才能指定角色或權限',
    };
  }

  const beyondOwn = (input.grantedPermissions ?? []).filter(
    (permission) => !hasPermission(input.permissions, permission),
  );
  if (beyondOwn.length > 0) {
    return {
      ok: false,
      reason: 'exceeds-own',
      message: `不能發出你自己沒有的權限：${beyondOwn.join('、')}`,
    };
  }

  return { ok: true };
}

const SELF_DENIED: RoleAssignmentVerdict = {
  ok: false,
  reason: 'self',
  message: '不能修改自己的角色與權限，請由其他管理員操作',
};

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/**
 * **改自己**（#1829，使用者 2026-10-22）。規則本意是「提權要經過另一個人」，所以：
 *
 * - 角色與權限都沒變 → 放行。表單存檔永遠帶 roles / permissions，不放行的話
 *   連改自己的姓名都 403。
 * - 權限有變 → 一律擋，`*` 也擋。
 * - 角色有變 → 只有持有 `*` 的人可以，而且 admin 不能進出：加上 teacher 不會多任何
 *   權限（權限只掛在 admin 列上），不是提權；拿掉自己的 admin 則可能把機構鎖死。
 */
function checkSelfAssignment(input: RoleAssignmentInput): RoleAssignmentVerdict {
  const prior = input.selfPrior;
  if (!prior) return SELF_DENIED;

  if (input.nextPermissions !== undefined && !sameSet(input.nextPermissions, prior.permissions)) {
    return SELF_DENIED;
  }

  const nextRoles = input.nextRoles ?? prior.roles;
  if (sameSet(nextRoles, prior.roles)) return { ok: true };

  if (!input.permissions.includes(WILDCARD_PERMISSION)) return SELF_DENIED;

  if (prior.roles.includes('admin') !== nextRoles.includes('admin')) {
    return { ok: false, reason: 'self', message: '不能移除自己的管理員角色，請由其他管理員操作' };
  }

  return { ok: true };
}

/** 新清單裡、對方原本沒有的權限 —— 「發出去」的只有這些 */
export function addedPermissions(prior: readonly string[], next: readonly string[]): string[] {
  return next.filter((permission) => !prior.includes(permission));
}
