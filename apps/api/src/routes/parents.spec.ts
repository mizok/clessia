import { describe, expect, it } from 'vitest';

describe('toParentResponse', () => {
  it('maps snake_case DB row to camelCase, email 優先作為 loginAccount', async () => {
    const { toParentResponse } = await import('./parents');

    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      status: 'active',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 2);
    expect(result).toMatchObject({
      id: 'parent-uuid',
      userId: 'ba-user-id',
      orgId: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      loginAccount: 'lin@example.com',
      status: 'active',
      studentCount: 2,
    });
  });

  it('無 email 時 loginAccount 使用 phone', async () => {
    const { toParentResponse } = await import('./parents');

    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '陳淑芬',
      phone: '0987654321',
      email: null,
      status: 'inactive',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 0);
    expect(result.loginAccount).toBe('0987654321');
  });
});

describe('generateRandomPassword', () => {
  it('產生 10 碼英數混合密碼', async () => {
    const { generateRandomPassword } = await import('./parents');
    const pwd = generateRandomPassword();
    expect(pwd).toHaveLength(10);
    expect(pwd).toMatch(/^[A-Za-z0-9]+$/);
  });
});
