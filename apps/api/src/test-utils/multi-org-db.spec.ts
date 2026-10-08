import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from './multi-org-db';

/**
 * 替身自己的紅燈（#1374）：巢狀欄位路徑中途遇到陣列（一對多 embed）時，`eq`／`in`
 * 要「任一筆子列符合即成立」—— 同 PostgREST 三層 `!inner` 的語意。
 * 改壞這條，`parent-campus-scope` 的範圍測試會跟著空轉。
 */

const db = () =>
  createMultiOrgDb({
    parent_student_relations: [
      {
        id: 'r1',
        parent_id: 'p1',
        students: {
          enrollments: [{ classes: { campus_id: 'A' } }, { classes: { campus_id: 'B' } }],
        },
      },
      { id: 'r2', parent_id: 'p2', students: { enrollments: [{ classes: { campus_id: 'B' } }] } },
      { id: 'r3', parent_id: 'p3', students: { enrollments: [] } },
    ],
    staff: [{ id: 's1', permissions: ['A'] }],
  });

const ids = (result: { data: unknown }) => (result.data as Array<{ id: string }>).map((r) => r.id);

describe('multi-org-db：陣列路徑攤平', () => {
  it('in：任一筆子列符合 → 進', async () => {
    const result = await (db().client as any)
      .from('parent_student_relations')
      .select('*')
      .in('students.enrollments.classes.campus_id', ['A']);
    expect(ids(result)).toEqual(['r1']);
  });

  it('in：全部子列都不符合（含沒有子列）→ 不進', async () => {
    const result = await (db().client as any)
      .from('parent_student_relations')
      .select('*')
      .in('students.enrollments.classes.campus_id', ['C']);
    expect(ids(result)).toEqual([]);
  });

  it('eq：任一筆子列符合 → 進；不符合 → 不進', async () => {
    const hit = await (db().client as any)
      .from('parent_student_relations')
      .select('*')
      .eq('students.enrollments.classes.campus_id', 'B');
    expect(ids(hit)).toEqual(['r1', 'r2']);
    const miss = await (db().client as any)
      .from('parent_student_relations')
      .select('*')
      .eq('students.enrollments.classes.campus_id', 'C');
    expect(ids(miss)).toEqual([]);
  });

  it('最後一層的陣列不攤：jsonb 陣列欄位 eq 純量不成立', async () => {
    const result = await (db().client as any).from('staff').select('*').eq('permissions', 'A');
    expect(ids(result)).toEqual([]);
  });
});
