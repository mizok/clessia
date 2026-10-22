import { describe, expect, it } from 'vitest';

import { usableRoleRows } from './usable-roles';

/**
 * #1846：登入之後可以用的角色，要跟著身分資料的狀態走。
 * 重現（10-22 本機）：teacher0005 的 staff 停用、parents 仍 active → `/api/me` 回 roles=["teacher","parent"]，
 * 老師端 API 200。登入判定（isAccountUsable）只看「任一身分 active」，角色卻直接取 user_roles。
 */

const role = (r: string, permissions: string[] = []) => ({ role: r, permissions });
const rows = (...statuses: string[]) => statuses.map((status) => ({ status }));
const names = (out: ReadonlyArray<{ role: string }>) => out.map((r) => r.role);

describe('usableRoleRows', () => {
  it('staff 停用、parents 啟用 → 只剩 parent（老師、管理員身分都拿掉）', () => {
    expect(
      names(
        usableRoleRows(
          [role('teacher'), role('admin', ['*']), role('parent')],
          rows('inactive'),
          rows('active'),
        ),
      ),
    ).toEqual(['parent']);
  });

  it('parents 停用、staff 啟用 → 拿掉 parent，老師留著', () => {
    expect(
      names(usableRoleRows([role('teacher'), role('parent')], rows('active'), rows('archived'))),
    ).toEqual(['teacher']);
  });

  it('兩邊都啟用 → 全部留著', () => {
    expect(
      names(usableRoleRows([role('teacher'), role('parent')], rows('active'), rows('active'))),
    ).toEqual(['teacher', 'parent']);
  });

  // 掃碼機台也是 staff 列（#1127）：機台被停用就不能再打卡
  it('kiosk 跟著 staff 列：停用 → 拿掉', () => {
    expect(names(usableRoleRows([role('kiosk')], rows('inactive'), []))).toEqual([]);
    expect(names(usableRoleRows([role('kiosk')], rows('active'), []))).toEqual(['kiosk']);
  });

  /**
   * **這條最容易寫錯**（同 account-status）：bootstrap 建的第一個管理員在 staff／parents 都沒有列。
   * 「沒有列」不等於「被停用」—— 只有列存在、而且沒有一列是 active，才拿掉那一類角色。
   */
  it('沒有 staff 列的管理員（bootstrap）→ 照舊是管理員', () => {
    expect(names(usableRoleRows([role('admin', ['*'])], [], []))).toEqual(['admin']);
  });

  it('沒有 parents 列的 parent 角色 → 照舊保留（列不存在不算停用）', () => {
    expect(names(usableRoleRows([role('parent')], rows('active'), []))).toEqual(['parent']);
  });

  it('未知的狀態值當成不是 active（fail-closed）', () => {
    expect(names(usableRoleRows([role('teacher')], rows('suspended'), []))).toEqual([]);
  });

  it('不認識的角色一律拿掉（fail-closed）', () => {
    expect(names(usableRoleRows([role('root'), role('teacher')], rows('active'), []))).toEqual([
      'teacher',
    ]);
  });

  it('權限跟著角色走：admin 被拿掉，它的權限也不在了', () => {
    const out = usableRoleRows(
      [role('admin', ['manage_finance']), role('parent')],
      rows('inactive'),
      rows('active'),
    );
    expect(out.flatMap((r) => r.permissions)).toEqual([]);
  });
});
