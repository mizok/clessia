import { describe, expect, it } from 'vitest';

import { addedPermissions, checkRoleAssignment } from './role-assignment';

const base = {
  permissions: ['manage_staff', 'manage_roles'],
  requesterUserId: 'me',
  targetUserId: 'someone-else',
  touchesRoleAssignment: true,
};

describe('checkRoleAssignment', () => {
  it('沒有動到角色與權限就不管 —— 那是 manage_staff 的事', () => {
    expect(checkRoleAssignment({ ...base, permissions: [], touchesRoleAssignment: false })).toEqual(
      { ok: true },
    );
  });

  it('有 manage_roles 改別人可以', () => {
    expect(checkRoleAssignment(base)).toEqual({ ok: true });
  });

  it('只有 manage_staff 不能指定角色或權限', () => {
    const verdict = checkRoleAssignment({ ...base, permissions: ['manage_staff'] });

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: 'missing-permission' });
  });

  // 提權的路一定要經過另一個人
  it('不能改自己的角色與權限', () => {
    const verdict = checkRoleAssignment({ ...base, targetUserId: 'me' });

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: 'self' });
  });

  // 這一條是重點：`*` 擋得住「權限不足」，擋不住「自己批准自己」。
  // 唯一的超級管理員如果能改自己，一次手滑就做出一個沒有人救得回來的機構。
  it('`*` 也不能改自己', () => {
    expect(checkRoleAssignment({ ...base, permissions: ['*'], targetUserId: 'me' })).toMatchObject({
      ok: false,
      reason: 'self',
    });
  });

  it('`*` 改別人可以', () => {
    expect(checkRoleAssignment({ ...base, permissions: ['*'] })).toEqual({ ok: true });
  });

  // 建立新帳號沒有對象，不可能是自己
  it('建立新帳號（targetUserId 是 null）只看 manage_roles', () => {
    expect(checkRoleAssignment({ ...base, targetUserId: null })).toEqual({ ok: true });
    expect(
      checkRoleAssignment({ ...base, targetUserId: null, permissions: ['manage_staff'] }),
    ).toMatchObject({ ok: false, reason: 'missing-permission' });
  });
});

/**
 * **權限只能給自己有的**（使用者 2026-10-01 裁定，#966 A2'）。
 *
 * 只看 `manage_roles` 的話，自己沒有 `manage_finance` 的管理員可以建一個有它的帳號，
 * 再替那個帳號鑄登入連結 —— 拿到自己原本沒有的權限。判的是**新增的**權限：
 * 對方原本就有、這次沒動的不算（否則連替別人多加一個自己有的權限都會被擋）。
 */
describe('checkRoleAssignment —— 新增的權限必須是自己有的', () => {
  it('發出自己沒有的權限 → 拒絕', () => {
    const verdict = checkRoleAssignment({ ...base, grantedPermissions: ['manage_finance'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe('exceeds-own');
  });

  it('只發自己有的 → 可以', () => {
    expect(checkRoleAssignment({ ...base, grantedPermissions: ['manage_staff'] })).toEqual({
      ok: true,
    });
  });

  it('`*` 可以發任何權限 —— 只有持有全部權限者能開任何權限', () => {
    expect(
      checkRoleAssignment({
        ...base,
        permissions: ['*'],
        grantedPermissions: ['manage_finance', 'all_campuses'],
      }),
    ).toEqual({ ok: true });
  });

  it('沒有新增任何權限（只拿掉、或原封不動）→ 這條不管', () => {
    expect(checkRoleAssignment({ ...base, grantedPermissions: [] })).toEqual({ ok: true });
  });
});

describe('addedPermissions', () => {
  it('新清單減掉原本的', () => {
    expect(addedPermissions(['manage_finance'], ['manage_finance', 'basic_operations'])).toEqual([
      'basic_operations',
    ]);
    expect(addedPermissions(['manage_finance'], [])).toEqual([]);
  });
});
