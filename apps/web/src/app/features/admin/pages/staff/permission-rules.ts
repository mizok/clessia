import { WILDCARD_PERMISSION, type HeldPermission, type Permission } from '@core/staff.service';

/**
 * 人員權限 UI 的「為什麼不能改」（#1314 ST3／ST8）。**判準是 API 的那一組，這裡只是提早說明**：
 * `apps/api/src/lib/role-assignment.ts`（改自己、`manage_roles`、只能發自己有的）與
 * `lib/campus-scope.ts` 的 `grantsWiderThanScope`。API 仍是唯一的關卡，畫面放行的照樣可能被擋。
 */
export interface Requester {
  readonly isSelf: boolean;
  /** 我有沒有這個權限（`*` 算全部） */
  readonly has: (permission: string) => boolean;
}

/** 一整張權限都不能改的原因；`null`＝可以改 */
export function permissionLock(me: Requester, target: readonly HeldPermission[]): string | null {
  if (me.isSelf) {
    return '這是你自己的帳號。任何人都不能改自己的權限，要調整請另一位有「角色管理」權限的人處理。';
  }
  if (!me.has('manage_roles')) {
    return '你沒有「角色管理」權限，只能查看。要調整請找有這個權限的人。';
  }
  // grantsWiderThanScope 看的是整份送出的清單：對方已有跨分校時，原樣送回也會被擋
  // （`*` 涵蓋跨分校，但對使用者要說「全部權限」，計畫席 11-05 二讀）
  if (!me.has('all_campuses')) {
    if (target.includes(WILDCARD_PERMISSION)) {
      return '他有全部權限，而你的範圍受分校限制，不能改他的權限。';
    }
    if (target.includes('all_campuses')) {
      return '他有「跨分校」權限，而你的範圍受分校限制，不能改他的權限。';
    }
  }
  return null;
}

/** 這一項不能「勾上」的原因（取消照樣可以）；`null`＝可以勾 */
export function cannotGrant(me: Requester, permission: Permission): string | null {
  if (!me.has(permission)) return '你沒有這個權限，不能發給別人';
  return null;
}

/**
 * 編輯表單的角色勾選框（`checkSelfAssignment`）：改自己時 admin 不能進出，
 * 老師角色只有持 `*` 的人能改；沒有 `manage_roles` 不能改別人的角色。
 */
export function roleLock(me: Requester, role: 'admin' | 'teacher'): string | null {
  if (me.isSelf) {
    if (role === 'admin') return '不能加上或拿掉自己的管理員角色';
    if (!me.has(WILDCARD_PERMISSION)) return '自己的角色要請另一位有「角色管理」權限的人調整';
    return null;
  }
  if (!me.has('manage_roles')) return '你沒有「角色管理」權限，角色只能查看';
  return null;
}
