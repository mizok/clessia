import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
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
    const childDb = createChildDb(client as never, ['s1', 's2'], 'org-1');

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
    const childDb = createChildDb(client as never, [], 'org-1');

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

    const childDb = createChildDb(client as never, null, 'org-1');
    const result = await childDb.from('students', 'id').select('*');

    expect(result).toBe(query);
    expect(calls.inCalled).toBe(false);
  });

  // 家長端的 meta 聚合數字（monthlyAbsentCount / recentCount / totalDue）要用
  // count/head 查詢算，不能靠當頁筆數 —— 這條釘住 options 有原樣傳到底層 supabase
  it('select() 的第二個參數（count/head）原樣傳給底層 supabase', async () => {
    const { calls, client } = fakeSupabase();
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

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
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

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
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

    const result = await childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id');

    expect(result.rows).toEqual([]);
    expect(result.ids).toEqual([]);
    expect(result.error).toEqual({ message: 'boom' });
  });

  it('fromScopedIds() 用 pluck() 產生的 ids 查沒有 student_id 的表', async () => {
    const { calls, client: pluckClient } = fakePluckSupabase([{ class_id: 'class-1' }]);
    const childDb = createChildDb(pluckClient as never, ['s1'], 'org-1');
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
    const scopedChildDb = createChildDb(scopedClient as never, ['s1'], 'org-1');
    await scopedChildDb.fromScopedIds('class_logs', 'class_id', ids).select('id, homework');

    expect(scopedCalls.table).toBe('class_logs');
    expect(scopedCalls.inColumn).toBe('class_id');
    expect(scopedCalls.inValues).toEqual(['class-1']);
  });

  it('型別擋：裸 string[] 傳不進 fromScopedIds，只有 pluck() 產生的 ScopedIds 過得了', () => {
    const client = { from: () => ({ select: () => ({ in: () => Promise.resolve({}) }) }) };
    const childDb = createChildDb(client as never, ['s1'], 'org-1');

    const bareArray: readonly string[] = ['class-1'];
    // @ts-expect-error —— 裸陣列不是 ScopedIds，這行本來就該編不過；
    // 拿掉這個註解時 tsc 應該報 TS2345，證明品牌型別真的在擋，不是只活在文件裡
    childDb.fromScopedIds('class_logs', 'class_id', bareArray);
  });
});

/**
 * 寫入口與機構參考資料（#1119，計畫席 10-03 裁 A＋B）。家長端第一次寫入 ——
 * 範圍檢查在**送 DB 之前**做，`org_id` 一律取 session 的、不吃呼叫端給的。
 * 用真的照條件過濾的替身：回固定資料的替身分不出條件有沒有下對。
 */
describe('createChildDb —— insert / update / orgRef / activeEnrollmentCount', () => {
  const MY_CHILD = 'stu-mine';
  const OTHER_CHILD = 'stu-other';

  it('insert：學生在 scope 內 → 寫入，org_id 蓋成 session 的（呼叫端給的別 org 被覆蓋）', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    const result = await childDb
      .from('enrollment_requests', 'student_id')
      .insert({ student_id: MY_CHILD, org_id: 'org-evil', status: 'pending' });

    expect(result.outOfScope).toBe(false);
    expect(db.rows('enrollment_requests')).toHaveLength(1);
    expect(db.rows('enrollment_requests')[0]?.['org_id']).toBe('org-1');
  });

  it('insert：scope 外的學生 → 不送 DB，回 outOfScope', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    const result = await childDb
      .from('enrollment_requests', 'student_id')
      .insert({ student_id: OTHER_CHILD, status: 'pending' });

    expect(result.outOfScope).toBe(true);
    expect(db.rows('enrollment_requests')).toHaveLength(0);
  });

  it('insert：不是家長（scope null）→ fail-closed，不送 DB', async () => {
    const db = createMultiOrgDb({});
    const childDb = createChildDb(db.client as never, null, 'org-1');

    const result = await childDb
      .from('enrollment_requests', 'student_id')
      .insert({ student_id: MY_CHILD });

    expect(result.outOfScope).toBe(true);
    expect(db.rows('enrollment_requests')).toHaveLength(0);
  });

  it('update：scope 外與別 org 的列選不到；學生欄位與 org_id 不會被改掉', async () => {
    const db = createMultiOrgDb({
      enrollment_requests: [
        { id: 'r-mine', org_id: 'org-1', student_id: MY_CHILD, status: 'pending' },
        { id: 'r-other', org_id: 'org-1', student_id: OTHER_CHILD, status: 'pending' },
        { id: 'r-foreign', org_id: 'org-2', student_id: MY_CHILD, status: 'pending' },
      ],
    });
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    await childDb
      .from('enrollment_requests', 'student_id')
      .update({ status: 'cancelled', student_id: OTHER_CHILD, org_id: 'org-2' });

    const state = Object.fromEntries(
      db.rows('enrollment_requests').map((r) => [r['id'], [r['status'], r['student_id']]]),
    );
    expect(state).toEqual({
      'r-mine': ['cancelled', MY_CHILD],
      'r-other': ['pending', OTHER_CHILD],
      'r-foreign': ['pending', MY_CHILD],
    });
  });

  it('update：不是家長（scope null）→ 一列都選不到', async () => {
    const db = createMultiOrgDb({
      enrollment_requests: [{ id: 'r', org_id: 'org-1', student_id: MY_CHILD, status: 'pending' }],
    });
    const childDb = createChildDb(db.client as never, null, 'org-1');

    await childDb.from('enrollment_requests', 'student_id').update({ status: 'cancelled' });

    expect(db.rows('enrollment_requests')[0]?.['status']).toBe('pending');
  });

  it('orgRef：只帶 org 條件，別 org 的班讀不到', async () => {
    const db = createMultiOrgDb({
      classes: [
        { id: 'c1', org_id: 'org-1' },
        { id: 'c2', org_id: 'org-2' },
      ],
    });
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    const { data } = await childDb.orgRef('classes').select('id');

    expect((data as unknown as Array<{ id: string }>).map((r) => r.id)).toEqual(['c1']);
  });

  it('activeEnrollmentCount：只回數字（在籍＋待繳費），不跨 org', async () => {
    const db = createMultiOrgDb({
      enrollments: [
        { org_id: 'org-1', class_id: 'c1', student_id: 'a', status: 'active' },
        { org_id: 'org-1', class_id: 'c1', student_id: 'b', status: 'pending_payment' },
        { org_id: 'org-1', class_id: 'c1', student_id: 'c', status: 'withdrawn' },
        { org_id: 'org-2', class_id: 'c1', student_id: 'd', status: 'active' },
      ],
    });
    const childDb = createChildDb(db.client as never, [MY_CHILD], 'org-1');

    expect(await childDb.activeEnrollmentCount('c1')).toEqual({ count: 2, error: null });
  });
});
