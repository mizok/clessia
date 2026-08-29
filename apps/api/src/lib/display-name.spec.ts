import { describe, expect, it } from 'vitest';

import { resolveDisplayName, updateDisplayName } from './display-name';

describe('resolveDisplayName', () => {
  it('有 profiles 就用它 —— seed 建的舊使用者走這條', () => {
    expect(
      resolveDisplayName({
        profile: { display_name: '王主任' },
        staff: { display_name: '不該用到' },
        baUser: { name: '也不該用到' },
      }),
    ).toBe('王主任');
  });

  // 這是本次事故的常態，不是例外：`handle_new_user()` 在 Better Auth 遷移時被 DROP，
  // 之後**任何透過 app 建立的使用者都沒有 profiles 列** —— 包含 bootstrap 建的第一個管理員。
  it('沒有 profiles 列時退到 staff', () => {
    expect(resolveDisplayName({ profile: null, staff: { display_name: '王主任' } })).toBe('王主任');
  });

  it('家長沒有 staff 列，退到 parents.name', () => {
    expect(resolveDisplayName({ profile: null, staff: null, parent: { name: '陳媽媽' } })).toBe(
      '陳媽媽',
    );
  });

  it('三個都沒有時退到 ba_user.name —— 那是 NOT NULL，一定有東西', () => {
    expect(
      resolveDisplayName({ profile: null, staff: null, parent: null, baUser: { name: '王主任' } }),
    ).toBe('王主任');
  });

  // 空字串正是這次的症狀：profiles 列不存在時 `?? ''` 讓 header 只剩 email。
  // 有列但欄位是空的、或只有空白，一樣要往下找，否則 fallback 等於沒接。
  it('空字串與只有空白都當成沒有，繼續往下找', () => {
    expect(
      resolveDisplayName({
        profile: { display_name: '' },
        staff: { display_name: '   ' },
        parent: { name: null },
        baUser: { name: '王主任' },
      }),
    ).toBe('王主任');
  });

  it('全部都沒有時回空字串，不回 undefined', () => {
    expect(resolveDisplayName({})).toBe('');
  });

  it('回傳值去掉前後空白', () => {
    expect(resolveDisplayName({ staff: { display_name: '  王主任  ' } })).toBe('王主任');
  });
});

/** 記下每一次 `from(x).update(y).eq(col, val)`，用來斷言寫到了哪些表。 */
function recordingSupabase() {
  const writes: Array<{ table: string; values: Record<string, unknown>; column: string }> = [];
  return {
    writes,
    client: {
      from: (table: string) => ({
        update: (values: Record<string, unknown>) => ({
          eq: (column: string, _value: string) => {
            writes.push({ table, values, column });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    },
  };
}

describe('updateDisplayName', () => {
  // 讀是 fallback 鏈，寫就得是「每一個可能被讀到的地方都寫」——
  // 只寫 profiles 的話（原本的作法）對沒有 profiles 列的人是**靜靜地 no-op**，
  // 改完名字存了等於沒存，而且回讀走 fallback 拿到舊值，看起來像讀的 bug。
  it('三個來源都寫，不做任何分支判斷 —— 沒有對應列的就是 no-op', async () => {
    const { writes, client } = recordingSupabase();

    await updateDisplayName(client as never, 'u1', '王主任');

    expect(writes).toEqual([
      { table: 'profiles', values: { display_name: '王主任' }, column: 'id' },
      { table: 'staff', values: { display_name: '王主任' }, column: 'user_id' },
      { table: 'parents', values: { name: '王主任' }, column: 'user_id' },
    ]);
  });

  // 同一個人可以同時是員工與家長（自己的小孩也在補習班）。兩處都更新是 feature：
  // 兩個身分本來就該顯示同一個名字。
  it('同時是 staff 又是 parent 的人，兩處都會被更新', async () => {
    const { writes, client } = recordingSupabase();

    await updateDisplayName(client as never, 'u1', '王主任');

    expect(writes.filter((w) => w.table === 'staff')).toHaveLength(1);
    expect(writes.filter((w) => w.table === 'parents')).toHaveLength(1);
  });

  // ba_user.name 是 Better Auth 的表 —— 可讀不可寫（c2）。
  it('不碰 ba_user', async () => {
    const { writes, client } = recordingSupabase();

    await updateDisplayName(client as never, 'u1', '王主任');

    expect(writes.map((w) => w.table)).not.toContain('ba_user');
  });
});
