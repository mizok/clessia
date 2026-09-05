import { describe, expect, it } from 'vitest';

import { createChildDb } from './child-db';

/** 只實作 `.from().select().in()` 這條鏈，並記下每次呼叫收到的參數。 */
function fakeSupabase() {
  const calls: {
    table?: string;
    columns?: string;
    options?: unknown;
    inColumn?: string;
    inValues?: string[];
  } = {};
  return {
    calls,
    client: {
      from: (table: string) => {
        calls.table = table;
        return {
          select: (columns: string, options?: unknown) => {
            calls.columns = columns;
            calls.options = options;
            const builder = {
              in: (col: string, values: string[]) => {
                calls.inColumn = col;
                calls.inValues = values;
                return Promise.resolve({ data: [], error: null });
              },
            };
            return builder;
          },
        };
      },
    },
  };
}

describe('createChildDb', () => {
  it('scope 是陣列時，每次 from().select() 都自動帶上 .in(studentIdColumn, scope)', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, ['s1', 's2']);

    await childDb.from('students', 'id').select('id, name');

    expect(calls.table).toBe('students');
    expect(calls.columns).toBe('id, name');
    expect(calls.inColumn).toBe('id');
    expect(calls.inValues).toEqual(['s1', 's2']);
  });

  // 這條是設計文件點死的：沒綁小孩的家長要查到「什麼都沒有」，
  // 不能因為 scope 是空陣列就略過條件、查到全部。
  it('scope 是空陣列時仍然送出 .in(column, [])，不是略過條件', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, []);

    await childDb.from('scores', 'student_id').select('*');

    expect(calls.inColumn).toBe('student_id');
    expect(calls.inValues).toEqual([]);
  });

  it('scope 是 null 時不加條件（理論上不會發生在家長端 route，但防禦性保留）', async () => {
    const calls: { inCalled: boolean } = { inCalled: false };
    const query = {
      in: () => {
        calls.inCalled = true;
        throw new Error('不該被呼叫');
      },
    };
    const client = { from: () => ({ select: () => query }) };

    const childDb = createChildDb(client as never, null);
    const result = await childDb.from('students', 'id').select('*');

    expect(result).toBe(query);
    expect(calls.inCalled).toBe(false);
  });

  // 家長端的 meta 聚合數字（monthlyAbsentCount / recentCount / totalDue）要用
  // count/head 查詢算，不能靠當頁筆數 —— 這條釘住 options 有原樣傳到底層 supabase
  it('select() 的第二個參數（count/head）原樣傳給底層 supabase', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, ['s1']);

    await childDb.from('scores', 'student_id').select('id', { count: 'exact', head: true });

    expect(calls.options).toEqual({ count: 'exact', head: true });
  });
});
