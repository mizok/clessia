import { describe, expect, it } from 'vitest';

import {
  applyCampusFilter,
  campusFilterIds,
  CampusScopeMissingError,
  getCampusScope,
  isCampusAllowed,
  resolveCampusScope,
  type CampusScope,
} from './campus-scope';

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

describe('applyCampusFilter', () => {
  function fakeQuery() {
    const calls: Array<{ column: string; values: string[] }> = [];
    const query = {
      calls,
      in(column: string, values: string[]) {
        calls.push({ column, values });
        return query;
      },
    };
    return query;
  }

  it('不受限又沒指定 → 不加條件', () => {
    const q = fakeQuery();
    applyCampusFilter(q, 'campus_id', null, undefined);
    expect(q.calls).toEqual([]);
  });

  it('有範圍就加 in 條件', () => {
    const q = fakeQuery();
    applyCampusFilter(q, 'classes.campus_id', ['a', 'b'], undefined);
    expect(q.calls).toEqual([{ column: 'classes.campus_id', values: ['a', 'b'] }]);
  });

  it('指定了就只用那一個（合法性由 campusRequestGuard 擋，這裡不重驗）', () => {
    const q = fakeQuery();
    applyCampusFilter(q, 'campus_id', ['a', 'b'], 'b');
    expect(q.calls).toEqual([{ column: 'campus_id', values: ['b'] }]);
  });

  // 一個分校都沒被指派 → 空清單，查詢回空而不是全部
  it('空範圍會加一個空的 in，不是不加條件', () => {
    const q = fakeQuery();
    applyCampusFilter(q, 'campus_id', [], undefined);
    expect(q.calls).toEqual([{ column: 'campus_id', values: [] }]);
  });
});

/**
 * `campusFilterIds` 的兜底那一半（2026-09-06）。
 *
 * 原本 `requested` 是**覆蓋** `scope`，安全性 100% 靠 `campusRequestGuard` 攔下
 * 範圍外的指名 —— 而那道守衛是白名單，漏列一個參數名就是一個跨分校讀取外洩
 *（`academy-exams` 的 snake_case `campus_id` 就這樣漏了）。
 *
 * **既有的測試全都用「範圍內」的值**（`['a','b']` 配 `'a'`），所以覆蓋語意
 * 危險的那一半**從來沒有被任何一支測試碰過** —— 這是它活這麼久的原因之一。
 */
describe('campusFilterIds —— 指名只能縮小範圍，撐不大它', () => {
  it('範圍外的指名回空清單，不是那個分校', () => {
    expect(campusFilterIds(['a'], 'b')).toEqual([]);
  });

  it('範圍內的指名行為完全不變（合法流量零影響）', () => {
    expect(campusFilterIds(['a', 'b'], 'b')).toEqual(['b']);
  });

  it('不受分校限制的管理員指定任一分校都照舊', () => {
    expect(campusFilterIds(null, 'b')).toEqual(['b']);
  });

  /**
   * **越權的正常結局仍然是 403（`campusRequestGuard`），不是這裡的空清單。**
   * 這條釘的是「兜底啟動之後查詢真的會空」，不是「越權應該安靜」——
   * 兩者的分工寫在 campus-scope.ts 的檔頭。
   */
  it('兜底啟動時，查詢下的是空的 in 條件（= 零筆，不是沒有條件）', () => {
    const calls: Array<{ column: string; values: string[] }> = [];
    const query = {
      in(column: string, values: string[]) {
        calls.push({ column, values });
        return query;
      },
    };

    applyCampusFilter(query, 'campus_id', ['a'], 'b');

    expect(calls).toEqual([{ column: 'campus_id', values: [] }]);
  });
});

/**
 * **缺席不是一種範圍，是 `authMiddleware` 沒跑。**
 *
 * 型別宣告（`AppEnv` 的 `campusScope: CampusScope`，沒有 `?`）說它一定有，
 * 而 runtime 拿得到 `undefined` —— **那個型別在 2026-09-06 之前是假的**。
 * 今天沒有產線路徑走得到（`requireRoles` 對缺席的 `roles` 已經 403，順便蓋住了），
 * 但**那道守衛守的是「你有沒有角色」，不是這件事**。見 issue #515。
 */
describe('getCampusScope —— 缺席時丟，不是回一個很窄的範圍', () => {
  function carrier(scope: CampusScope | undefined) {
    return { get: (_key: 'campusScope') => scope };
  }

  it('⚠️ 缺席 → 丟，而且訊息說得出為什麼', () => {
    // 回 `[]` 會讓「middleware 沒掛」看起來像「那個分校今天沒資料」——
    // 而那正是本檔 isCampusAllowed 檔頭反對的靜默空清單
    expect(() => getCampusScope(carrier(undefined))).toThrow(CampusScopeMissingError);
    // 訊息要指到原因，不是只說「沒有分校範圍」（那會讓人去查資料）
    expect(() => getCampusScope(carrier(undefined))).toThrow(/authMiddleware/);
  });

  it('`null` 照過 —— 那是合法值（角色不受分校限制）', () => {
    // 老師與家長的合法值就是 null，他們由更窄的範圍把關。
    // 把 null 一起擋掉會鎖死所有老師與家長
    expect(getCampusScope(carrier(null))).toBeNull();
  });

  it('空陣列照過 —— 那也是合法值（管理員沒被指派分校）', () => {
    // `[]` 是「什麼都看不到」的 fail-closed，它跟「缺席」是兩件事
    expect(getCampusScope(carrier([]))).toEqual([]);
  });

  it('有指派的分校原樣回', () => {
    expect(getCampusScope(carrier(['campus-1']))).toEqual(['campus-1']);
  });
});

describe('isCampusAllowed —— 缺席時拒絕', () => {
  it('⚠️ 缺席 → false，即使沒有指名分校', () => {
    // `daily-checkins.ts` 的 body 守衛走這一支、**不經過 getCampusScope**，
    // 所以兩個入口都要各自 fail-closed。少了這裡，一支忘記掛 middleware 的
    // 寫入端點會直接放行
    expect(isCampusAllowed(undefined, 'campus-1')).toBe(false);
    expect(isCampusAllowed(undefined, undefined)).toBe(false);
  });

  it('`null`（不受限）仍然放行 —— 缺席與不受限不能混為一談', () => {
    expect(isCampusAllowed(null, 'campus-1')).toBe(true);
  });
});
