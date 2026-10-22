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
  it('`*` 也不能改自己（沒給 selfPrior 時照舊一律擋）', () => {
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

/**
 * **改自己**（#1829）：加一個非 admin 角色不會多任何權限，不是提權 ——
 * 持有 `*` 的人可以替自己加減；權限仍然不能改、admin 仍然不能拿掉。
 */
describe('checkRoleAssignment —— 改自己（#1829）', () => {
  const selfBase = {
    ...base,
    permissions: ['*'],
    targetUserId: 'me',
    selfPrior: { roles: ['admin'], permissions: ['*'] },
  };

  it('`*` 替自己加 teacher → 可以', () => {
    expect(checkRoleAssignment({ ...selfBase, nextRoles: ['admin', 'teacher'] })).toEqual({
      ok: true,
    });
  });

  it('`*` 替自己拿掉 teacher → 可以', () => {
    expect(
      checkRoleAssignment({
        ...selfBase,
        selfPrior: { roles: ['admin', 'teacher'], permissions: ['*'] },
        nextRoles: ['admin'],
      }),
    ).toEqual({ ok: true });
  });

  it('`*` 改自己的權限 → self', () => {
    expect(checkRoleAssignment({ ...selfBase, nextPermissions: ['manage_staff'] })).toMatchObject({
      ok: false,
      reason: 'self',
    });
  });

  it('`*` 拿掉自己的 admin → self', () => {
    expect(checkRoleAssignment({ ...selfBase, nextRoles: ['teacher'] })).toMatchObject({
      ok: false,
      reason: 'self',
    });
  });

  it('沒有 `*` 的人替自己加 teacher → self', () => {
    expect(
      checkRoleAssignment({
        ...selfBase,
        permissions: ['manage_staff', 'manage_roles'],
        selfPrior: { roles: ['admin'], permissions: ['manage_staff', 'manage_roles'] },
        nextRoles: ['admin', 'teacher'],
      }),
    ).toMatchObject({ ok: false, reason: 'self' });
  });

  // 表單存檔永遠帶 roles / permissions —— 沒變就是沒改，改姓名不該被擋
  it('角色與權限都原樣送回 → 可以（不論有沒有 `*`）', () => {
    expect(
      checkRoleAssignment({ ...selfBase, nextRoles: ['admin'], nextPermissions: ['*'] }),
    ).toEqual({ ok: true });
    expect(
      checkRoleAssignment({
        ...selfBase,
        permissions: ['manage_staff'],
        selfPrior: { roles: ['admin'], permissions: ['manage_staff'] },
        nextRoles: ['admin'],
        nextPermissions: ['manage_staff'],
      }),
    ).toEqual({ ok: true });
  });

  it('集合比較：重複值不會讓不同的清單被當成一樣', () => {
    expect(
      checkRoleAssignment({
        ...selfBase,
        selfPrior: { roles: ['admin'], permissions: ['manage_staff', 'manage_roles'] },
        nextPermissions: ['manage_staff', 'manage_staff'],
      }),
    ).toMatchObject({ ok: false, reason: 'self' });
  });
});

describe('checkRoleAssignment —— `*` 本身也只有持有者能發（#1829）', () => {
  it('有 manage_roles、沒有 `*` 的人發 `*` → exceeds-own', () => {
    expect(checkRoleAssignment({ ...base, grantedPermissions: ['*'] })).toMatchObject({
      ok: false,
      reason: 'exceeds-own',
    });
  });

  it('持有 `*` 的人發 `*` → 可以', () => {
    expect(checkRoleAssignment({ ...base, permissions: ['*'], grantedPermissions: ['*'] })).toEqual(
      { ok: true },
    );
  });
});
