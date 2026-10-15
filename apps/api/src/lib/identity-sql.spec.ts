import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadIdentityViaSql, loadMeExtrasViaSql, parseIdentityRow } from './identity-sql';

/**
 * Hyperdrive A：SQL 的結果**只要看起來不對就回 null**，讓呼叫端走 REST。
 * 不能猜：形狀不對時當成「沒有角色」會擋掉該進的人，當成「已停用」也一樣，當成放行更糟。
 */

const GOOD = {
  roles: [{ role: 'admin', permissions: ['manage_students'] }],
  staff: [
    {
      status: 'active',
      display_name: '王主任',
      birthday: '1990-01-02',
      staff_campuses: [{ campus_id: 'c-1' }],
    },
  ],
  parents: [
    { status: 'active', name: '王媽媽', parent_student_relations: [{ student_id: 's-1' }] },
  ],
};

describe('parseIdentityRow', () => {
  it('形狀正確 → 跟 REST 那條同一個形狀', () => {
    expect(parseIdentityRow([GOOD])).toEqual({
      roleRows: GOOD.roles,
      staffRows: GOOD.staff,
      parentRows: GOOD.parents,
    });
  });

  it('全部是空陣列也是合法的（真的沒有角色）', () => {
    expect(parseIdentityRow([{ roles: [], staff: [], parents: [] }])).toEqual({
      roleRows: [],
      staffRows: [],
      parentRows: [],
    });
  });

  it.each([
    ['沒有列', []],
    ['兩列', [GOOD, GOOD]],
    ['不是物件', ['x']],
    ['roles 不是陣列', [{ ...GOOD, roles: 'admin' }]],
    ['roles 是 null', [{ ...GOOD, roles: null }]],
    ['role 不是字串', [{ ...GOOD, roles: [{ role: 1, permissions: [] }] }]],
    ['permissions 是物件', [{ ...GOOD, roles: [{ role: 'admin', permissions: {} }] }]],
    ['staff 少了 status', [{ ...GOOD, staff: [{ ...GOOD.staff[0], status: undefined }] }]],
    ['staff_campuses 不是陣列', [{ ...GOOD, staff: [{ ...GOOD.staff[0], staff_campuses: null }] }]],
    [
      'campus_id 不是字串',
      [{ ...GOOD, staff: [{ ...GOOD.staff[0], staff_campuses: [{ campus_id: 7 }] }] }],
    ],
    ['parents 少了關聯欄位', [{ ...GOOD, parents: [{ status: 'active', name: 'x' }] }]],
    [
      'student_id 不是字串',
      [{ ...GOOD, parents: [{ ...GOOD.parents[0], parent_student_relations: [{}] }] }],
    ],
  ])('形狀不對 → null：%s', (_label, rows) => {
    expect(parseIdentityRow(rows as unknown[])).toBeNull();
  });
});

describe('loadIdentityViaSql', () => {
  afterEach(() => vi.restoreAllMocks());

  it('查詢拋錯 → null；log 只印錯誤碼，不印訊息（訊息可能帶出參數值）', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('invalid input syntax for type uuid: "SECRET-ORG"'), {
      code: '22P02',
    });
    const db = { query: vi.fn().mockRejectedValue(err) };

    expect(await loadIdentityViaSql(db, 'u', 'SECRET-ORG')).toBeNull();
    expect(String(log.mock.calls[0]?.[0])).toContain('22P02');
    expect(String(log.mock.calls[0]?.[0])).not.toContain('SECRET-ORG');
  });

  it('形狀不對 → null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ roles: 'x', staff: [], parents: [] }] }),
    };
    expect(await loadIdentityViaSql(db, 'u', 'o')).toBeNull();
  });

  it('roles 是空的 → null（不信「沒有角色」，交給 REST 確認；#1616）', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ roles: [], staff: GOOD.staff, parents: GOOD.parents }],
      }),
    };
    expect(await loadIdentityViaSql(db, 'u', 'o')).toBeNull();
    expect(String(log.mock.calls[0]?.[0])).toContain('roles 為空');
  });

  it('參數是 [user id, org id]', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [GOOD] }) };
    await loadIdentityViaSql(db, 'user-1', 'org-1');
    expect(db.query.mock.calls[0]?.[1]).toEqual(['user-1', 'org-1']);
  });
});

describe('loadMeExtrasViaSql', () => {
  afterEach(() => vi.restoreAllMocks());

  it('有 profiles 列 → profile 有值；沒有 → null（同 REST 的 maybeSingle）', async () => {
    const row = {
      profile_display_name: '舊名',
      profile_rows: 1,
      name: 'n',
      email: 'e',
      phone: null,
    };
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
    expect(await loadMeExtrasViaSql(db, 'u', 'o')).toEqual({
      profile: { display_name: '舊名' },
      baUser: { name: 'n', email: 'e', phone: null },
    });

    db.query.mockResolvedValue({ rows: [{ ...row, profile_display_name: null, profile_rows: 0 }] });
    expect((await loadMeExtrasViaSql(db, 'u', 'o'))?.profile).toBeNull();
  });

  it.each([
    ['沒有 ba_user 列', []],
    [
      'email 不是字串',
      [{ profile_display_name: null, profile_rows: 0, name: 'n', email: 1, phone: null }],
    ],
    [
      'profile_rows 是 2',
      [{ profile_display_name: null, profile_rows: 2, name: 'n', email: 'e', phone: null }],
    ],
  ])('形狀不對 → null：%s', async (_label, rows) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = { query: vi.fn().mockResolvedValue({ rows }) };
    expect(await loadMeExtrasViaSql(db, 'u', 'o')).toBeNull();
  });

  it('查詢拋錯 → null', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = { query: vi.fn().mockRejectedValue(new Error('boom')) };
    expect(await loadMeExtrasViaSql(db, 'u', 'o')).toBeNull();
  });
});
