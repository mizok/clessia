import { describe, expect, it } from 'vitest';

import { createChildDb, type ScopedIds } from './child-db';

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

/**
 * `pluck()` / `fromScopedIds()` —— 給沒有 `student_id` 欄位的表（如
 * `class_logs`，班級層級不是學生層級）用。見
 * kb/wiki/architecture/parent-class-logs-read.md 第三節。
 */
describe('createChildDb —— pluck / fromScopedIds', () => {
  function fakePluckSupabase(rows: unknown[]) {
    const calls: { table?: string; inColumn?: string; inValues?: string[] } = {};
    return {
      calls,
      client: {
        from: (table: string) => {
          calls.table = table;
          return {
            select: () => ({
              in: (col: string, values: string[]) => {
                calls.inColumn = col;
                calls.inValues = values;
                return Promise.resolve({ data: rows, error: null });
              },
            }),
          };
        },
      },
    };
  }

  it('pluck() 一次回完整列與去重後的 ScopedIds', async () => {
    const rows = [
      { class_id: 'class-1', effective_from: '2026-01-01' },
      { class_id: 'class-2', effective_from: '2026-04-01' },
      { class_id: 'class-1', effective_from: '2026-07-01' },
    ];
    const { client } = fakePluckSupabase(rows);
    const childDb = createChildDb(client as never, ['s1']);

    const result = await childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id');

    expect(result.error).toBeNull();
    expect(result.rows).toEqual(rows);
    expect(result.ids).toEqual(['class-1', 'class-2']);
  });

  it('pluck() 查詢失敗時 rows 與 ids 都回空，不吞錯誤', async () => {
    const client = {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    };
    const childDb = createChildDb(client as never, ['s1']);

    const result = await childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id');

    expect(result.rows).toEqual([]);
    expect(result.ids).toEqual([]);
    expect(result.error).toEqual({ message: 'boom' });
  });

  it('fromScopedIds() 用 pluck() 產生的 ids 查沒有 student_id 的表', async () => {
    const { calls, client: pluckClient } = fakePluckSupabase([{ class_id: 'class-1' }]);
    const childDb = createChildDb(pluckClient as never, ['s1']);
    const { ids } = await childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id');
    expect(calls.table).toBe('enrollments');

    const scopedCalls: { table?: string; inColumn?: string; inValues?: readonly string[] } = {};
    const scopedClient = {
      from: (table: string) => {
        scopedCalls.table = table;
        return {
          select: () => ({
            in: (col: string, values: readonly string[]) => {
              scopedCalls.inColumn = col;
              scopedCalls.inValues = values;
              return Promise.resolve({ data: [], error: null });
            },
          }),
        };
      },
    };
    const scopedChildDb = createChildDb(scopedClient as never, ['s1']);
    await scopedChildDb.fromScopedIds('class_logs', 'class_id', ids).select('id, homework');

    expect(scopedCalls.table).toBe('class_logs');
    expect(scopedCalls.inColumn).toBe('class_id');
    expect(scopedCalls.inValues).toEqual(['class-1']);
  });

  it('型別擋：裸 string[] 傳不進 fromScopedIds，只有 pluck() 產生的 ScopedIds 過得了', () => {
    const client = { from: () => ({ select: () => ({ in: () => Promise.resolve({}) }) }) };
    const childDb = createChildDb(client as never, ['s1']);

    const bareArray: readonly string[] = ['class-1'];
    // @ts-expect-error —— 裸陣列不是 ScopedIds，這行本來就該編不過；
    // 拿掉這個註解時 tsc 應該報 TS2345，證明品牌型別真的在擋，不是只活在文件裡
    childDb.fromScopedIds('class_logs', 'class_id', bareArray);
  });
});
