import { hasPermission } from './permissions';

/**
 * 誰可以決定別人有哪些角色與權限。
 *
 * **這件事比「管理人事資料」更高一級。** `manage_staff` 管的是姓名、電話、分校指派、
 * 停用封存；決定一個人是不是管理員、有哪些權限，是 `manage_roles`。分開的理由是
 * 提權：能建帳號的人如果同時能指定角色與權限，他就能給自己開一個權限全開的帳號。
 *
 * 所以還有第二條規則：**不能改自己的角色與權限，有什麼權限都不行。**
 * 提權的路一定要經過另一個人。這一條連 `*` 都擋 —— 它擋的不是權限不足，
 * 是「自己批准自己」這個動作。
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
}

export type RoleAssignmentVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'self' | 'missing-permission';
      readonly message: string;
    };

export function checkRoleAssignment(input: RoleAssignmentInput): RoleAssignmentVerdict {
  if (!input.touchesRoleAssignment) {
    return { ok: true };
  }

  // 自己批准自己一律不行，順序在權限檢查之前 —— `*` 也擋。
  if (input.targetUserId !== null && input.targetUserId === input.requesterUserId) {
    return {
      ok: false,
      reason: 'self',
      message: '不能修改自己的角色與權限，請由其他管理員操作',
    };
  }

  if (!hasPermission(input.permissions, 'manage_roles')) {
    return {
      ok: false,
      reason: 'missing-permission',
      message: '需要「管理角色權限」才能指定角色或權限',
    };
  }

  return { ok: true };
}
