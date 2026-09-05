import { describe, expect, it } from 'vitest';
import { countSubjectUsage } from './subject-usage';

function createFakeSupabase(rows: Array<{ subject_id: string | null }>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onfulfilled ?? undefined),
  };
  return { from: () => builder };
}

function createFailingSupabase() {
  const error = { message: 'boom' };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error }).then(onfulfilled ?? undefined),
  };
  return { from: () => builder };
}

describe('countSubjectUsage', () => {
  it('沒有任何 subjectId 時直接回空 map，不查資料庫', async () => {
    const result = await countSubjectUsage({
      supabase: createFailingSupabase() as never,
      orgId: 'org-1',
      table: 'courses',
      subjectIds: [],
    });
    expect(result.error).toBeNull();
    expect(result.counts.size).toBe(0);
  });

  it('依 subject_id 分組計數，一個科目被多筆用著要算對次數', async () => {
    const supabase = createFakeSupabase([
      { subject_id: 'subject-1' },
      { subject_id: 'subject-1' },
      { subject_id: 'subject-2' },
    ]);
    const result = await countSubjectUsage({
      supabase: supabase as never,
      orgId: 'org-1',
      table: 'academy_exams',
      subjectIds: ['subject-1', 'subject-2', 'subject-3'],
    });
    expect(result.error).toBeNull();
    expect(result.counts.get('subject-1')).toBe(2);
    expect(result.counts.get('subject-2')).toBe(1);
    expect(result.counts.has('subject-3')).toBe(false);
  });

  it('查詢失敗時 fail closed —— 回空 map 加錯誤，不能被誤讀成「沒有用到」', async () => {
    const result = await countSubjectUsage({
      supabase: createFailingSupabase() as never,
      orgId: 'org-1',
      table: 'academy_exams',
      subjectIds: ['subject-1'],
    });
    expect(result.error).toEqual({ message: 'boom' });
    expect(result.counts.size).toBe(0);
  });
});
