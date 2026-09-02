import { describe, expect, it } from 'vitest';

import { checkRoleAssignment } from './role-assignment';

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
