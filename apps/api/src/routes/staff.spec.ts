import { describe, expect, it } from 'vitest';

import * as staffRoute from './staff';

describe('buildStaffSummary', () => {
  /**
   * **`adminCount + teacherCount` 大於 `total` 是刻意的，不是這個測試寫錯**。
   * `adminCount` / `teacherCount` 是**角色人次**，不是 `total`（不重複人數）的分割——
   * 同時具備 admin 與 teacher 兩個角色的人（分校主任兼授課老師，補習班很常見）
   * 會在兩邊都被算一次。
   *
   * P1-4 事故（tester 回報「101 位人員・13 管理員・89 老師，13+89=102」）就是這個
   * 不變式第一次被誤讀成 bug：**101 與 102 都是對的**，只是前端把兩種數字（人數 vs
   * 人次）畫成看起來同一種東西。`multiRoleCount` 是這次補的——把「有沒有兼」明確
   * 算出來，不是讓消費端自己去導 `adminCount + teacherCount - total` 這個不明顯的
   * 不變式（角色種類以後增加的話，那個推導方式會先壞掉）。
   *
   * 這個 3 人的 fixture 刻意包含 1 個雙角色的人，讓 `2 + 2 ≠ 3` 這個看起來像
   * bug 的斷言留在測試裡——**下一個看到這個不一致的人不該去「修好」它**。
   */
  it('adminCount 跟 teacherCount 是角色人次，同一人可能兩邊都算——不是 total 的分割', () => {
    const buildStaffSummary = (staffRoute as Record<string, unknown>)['buildStaffSummary'] as
      | ((
          rows: Array<{ user_id: string; status: string }>,
          roleInfoMap: Map<string, { roles: Array<'admin' | 'teacher'> }>,
        ) => {
          total: number;
          adminCount: number;
          teacherCount: number;
          multiRoleCount: number;
          activeCount: number;
          inactiveCount: number;
          archivedCount: number;
        })
      | undefined;

    expect(buildStaffSummary).toBeTypeOf('function');

    const summary = buildStaffSummary?.(
      [
        { user_id: 'user-1', status: 'active' },
        { user_id: 'user-2', status: 'inactive' },
        { user_id: 'user-3', status: 'archived' },
      ],
      new Map([
        ['user-1', { roles: ['admin'] }],
        ['user-2', { roles: ['teacher'] }],
        // user-3 同時是 admin 又是 teacher —— 這是 adminCount+teacherCount > total 的來源
        ['user-3', { roles: ['admin', 'teacher'] }],
      ]),
    );

    expect(summary).toEqual({
      total: 3,
      adminCount: 2,
      teacherCount: 2,
      multiRoleCount: 1,
      activeCount: 1,
      inactiveCount: 1,
      archivedCount: 1,
    });
  });
});
