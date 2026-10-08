import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import { isParentWithinScope, resolveScopedParentIds } from './parent-campus-scope';

/**
 * 家長的分校範圍（#1374）：一支三層 `!inner` 查詢、撈到底。
 * 原本先撈報名、再撈關聯，兩支都吃 `max_rows` 1000 —— 範圍內破千時後面的家長靜默消失。
 */

const A = 'campus-a';
const B = 'campus-b';

const relation = (n: number, parent: string, campuses: string[]) => ({
  id: `r${String(n).padStart(5, '0')}`,
  parent_id: parent,
  students: { enrollments: campuses.map((campus_id) => ({ classes: { campus_id } })) },
});

const client = (rows: Array<ReturnType<typeof relation>>, maxRows?: number) => {
  const db = createMultiOrgDb({ parent_student_relations: rows });
  return (maxRows ? withMaxRows(db.client, maxRows) : db.client) as SupabaseClient;
};

describe('resolveScopedParentIds（#1374）', () => {
  it('孩子在範圍內有報名的家長才進；跨校孩子的家長兩校都進', async () => {
    const rows = [relation(1, 'p-a', [A]), relation(2, 'p-b', [B]), relation(3, 'p-ab', [B, A])];
    expect((await resolveScopedParentIds(client(rows), [A]))?.sort()).toEqual(['p-a', 'p-ab']);
    expect((await resolveScopedParentIds(client(rows), [B]))?.sort()).toEqual(['p-ab', 'p-b']);
  });

  it('不受限 → null；一個分校都沒被指派 → []', async () => {
    const rows = [relation(1, 'p-a', [A])];
    expect(await resolveScopedParentIds(client(rows), null)).toBeNull();
    expect(await resolveScopedParentIds(client(rows), [])).toEqual([]);
  });

  // 陷阱：PostgREST 撈列只回前 1000 列、不報錯
  it('範圍內關聯破千：第 1001 條關聯的家長還在', async () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, i) => relation(i, `p${i % 7}`, [A])),
      relation(1000, 'p-last', [A]),
    ];
    const ids = await resolveScopedParentIds(client(rows, 1000), [A]);
    expect(ids).toContain('p-last');
    expect(await isParentWithinScope(client(rows, 1000), [A], 'p-last')).toBe(true);
  });

  it('查詢失敗 → 丟，不折成「範圍內沒有家長」', async () => {
    const failing = {
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'in', 'order', 'range']) b[m] = () => b;
        b['then'] = (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'boom' } });
        return b;
      },
    } as unknown as SupabaseClient;
    await expect(resolveScopedParentIds(failing, [A])).rejects.toThrow('boom');
  });
});
