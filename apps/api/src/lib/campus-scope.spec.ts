import { describe, expect, it } from 'vitest';

import { campusFilterIds, isCampusAllowed, resolveCampusScope } from './campus-scope';

describe('resolveCampusScope', () => {
  it('有 all_campuses 的管理員不受限', () => {
    expect(
      resolveCampusScope({
        roles: ['admin'],
        permissions: ['all_campuses'],
        assignedCampusIds: ['a'],
      }),
    ).toBeNull();
  });

  it('`*` 通吃', () => {
    expect(
      resolveCampusScope({ roles: ['admin'], permissions: ['*'], assignedCampusIds: ['a'] }),
    ).toBeNull();
  });

  it('一般管理員限制在被指派的分校', () => {
    expect(
      resolveCampusScope({ roles: ['admin'], permissions: [], assignedCampusIds: ['a', 'b'] }),
    ).toEqual(['a', 'b']);
  });

  // fail-closed：「還沒指派」不等於「全部看得到」。
  // bootstrap-org.util.ts 明說沒有列的意思是還沒指派，把它讀成全開正是授權的洞
  // 最常長出來的地方。
  it('沒有被指派任何分校的管理員什麼都看不到', () => {
    expect(
      resolveCampusScope({ roles: ['admin'], permissions: [], assignedCampusIds: [] }),
    ).toEqual([]);
  });

  // 老師由 teacher-scope 限制（只碰自己任課的班，比分校更窄）。對他們套分校範圍
  // 不增加安全性，只會把沒有 staff_campuses 列的老師整個鎖死。
  it('老師不套分校範圍', () => {
    expect(
      resolveCampusScope({ roles: ['teacher'], permissions: [], assignedCampusIds: [] }),
    ).toBeNull();
  });
});

describe('isCampusAllowed', () => {
  it('沒指定分校時一律可以', () => {
    expect(isCampusAllowed(['a'], undefined)).toBe(true);
  });

  it('不受限的人指定哪個都行', () => {
    expect(isCampusAllowed(null, 'z')).toBe(true);
  });

  it('指定範圍內的分校可以', () => {
    expect(isCampusAllowed(['a', 'b'], 'b')).toBe(true);
  });

  // 這一條是洞 5 的本體
  it('指定範圍外的分校不行', () => {
    expect(isCampusAllowed(['a'], 'b')).toBe(false);
  });

  it('一個分校都沒被指派時，指定任何分校都不行', () => {
    expect(isCampusAllowed([], 'a')).toBe(false);
  });
});

describe('campusFilterIds', () => {
  it('不受限又沒指定 → 不加條件', () => {
    expect(campusFilterIds(null, undefined)).toBeNull();
  });

  it('指定了就用那一個', () => {
    expect(campusFilterIds(['a', 'b'], 'a')).toEqual(['a']);
  });

  it('有範圍但沒指定 → 用他全部的分校', () => {
    expect(campusFilterIds(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });

  it('沒有任何分校 → 空清單，查詢會回空而不是全部', () => {
    expect(campusFilterIds([], undefined)).toEqual([]);
  });
});
