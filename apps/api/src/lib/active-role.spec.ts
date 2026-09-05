import { describe, expect, it } from 'vitest';

import { resolveActiveRole } from './active-role';

describe('resolveActiveRole', () => {
  it('沒有帶 header 回 null', () => {
    expect(resolveActiveRole(undefined, ['admin', 'teacher'])).toBeNull();
    expect(resolveActiveRole(null, ['admin'])).toBeNull();
  });

  it('帶的角色是這個人的角色之一時採信', () => {
    expect(resolveActiveRole('teacher', ['admin', 'teacher'])).toBe('teacher');
  });

  // 沒有這層驗證的話，只有 teacher 角色的人送 X-Active-Role: admin
  // 就能讓「看 activeRole 才決定給誰看」的判斷跟著走偏。
  it('帶的角色不是這個人的角色之一時回 null，不是照單全收', () => {
    expect(resolveActiveRole('admin', ['teacher'])).toBeNull();
  });
});
