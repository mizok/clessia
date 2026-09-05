import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import subjectsRoute from './subjects';

const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';

interface UsageRow {
  subject_id: string;
}

function countableQuery(rows: UsageRow[] | 'error') {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve(
        rows === 'error' ? { data: null, error: { message: 'boom' } } : { data: rows, error: null },
      ).then(onfulfilled ?? undefined),
  };
  return builder;
}

/**
 * 這是 M8 稽核發現的那個洞：科目只被 academy_exams 用著（零課程），舊版的
 * DELETE 只查 courses，會直接刪掉科目、讓考試的 subject_id 被 ON DELETE
 * SET NULL 靜靜清空。這組測試釘住修完之後兩條路徑都要擋。
 */
function createDeleteTestApp(fixture: {
  courseRows: UsageRow[] | 'error';
  examRows: UsageRow[] | 'error';
}) {
  let subjectDeleted = false;

  const supabase = {
    from(table: string) {
      if (table === 'courses') return countableQuery(fixture.courseRows);
      if (table === 'academy_exams') return countableQuery(fixture.examRows);
      if (table === 'subjects') {
        return {
          delete: () => ({
            eq: () => {
              subjectDeleted = true;
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`Unsupported table in this fixture: ${table}`);
    },
  };

  const app = new Hono();
  app.use('/api/subjects/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', 'org-1');
    await next();
  });
  app.route('/api/subjects', subjectsRoute);

  return { app, wasSubjectDeleted: () => subjectDeleted };
}

describe('DELETE /api/subjects/:id —— 用量守門', () => {
  it('零課程、零校內考時可以刪除', async () => {
    const { app, wasSubjectDeleted } = createDeleteTestApp({ courseRows: [], examRows: [] });
    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(wasSubjectDeleted()).toBe(true);
  });

  it('有課程使用中要擋，回 409 IN_USE_COURSES', async () => {
    const { app, wasSubjectDeleted } = createDeleteTestApp({
      courseRows: [{ subject_id: SUBJECT_ID }],
      examRows: [],
    });
    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'IN_USE_COURSES' });
    expect(wasSubjectDeleted()).toBe(false);
  });

  // 這是 M8 稽核發現的那個洞本身：零課程（舊版唯一查的那張表放行），
  // 但有校內考在用（ON DELETE SET NULL，DB 不會擋）——修好之前這裡會被刪除。
  it('零課程但有校內考使用中，仍要擋，回 409 IN_USE_ACADEMY_EXAMS（M8 洞的迴歸測試）', async () => {
    const { app, wasSubjectDeleted } = createDeleteTestApp({
      courseRows: [],
      examRows: [{ subject_id: SUBJECT_ID }],
    });
    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'IN_USE_ACADEMY_EXAMS' });
    expect(wasSubjectDeleted()).toBe(false);
  });

  it('courses 用量查詢失敗時 fail closed，回 500 不繼續往下查', async () => {
    const { app, wasSubjectDeleted } = createDeleteTestApp({ courseRows: 'error', examRows: [] });
    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(500);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'SUBJECT_USAGE_CHECK_FAILED',
    });
    expect(wasSubjectDeleted()).toBe(false);
  });

  it('academy_exams 用量查詢失敗時 fail closed，回 500 —— 不能把查詢失敗當成「沒有用到」', async () => {
    const { app, wasSubjectDeleted } = createDeleteTestApp({ courseRows: [], examRows: 'error' });
    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(500);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'SUBJECT_USAGE_CHECK_FAILED',
    });
    expect(wasSubjectDeleted()).toBe(false);
  });
});

describe('GET /api/subjects —— 列表帶用量欄位', () => {
  it('批次回每個科目的 courseCount / academyExamCount，不是每列各發一次查詢', async () => {
    const subjectRows = [
      { id: 'subject-1', name: '數學', sort_order: 1 },
      { id: 'subject-2', name: '英文', sort_order: 2 },
    ];
    const supabase = {
      from(table: string) {
        if (table === 'subjects') {
          const builder = {
            select: () => builder,
            eq: () => builder,
            order: () => builder,
            then: (onfulfilled?: (value: unknown) => unknown) =>
              Promise.resolve({ data: subjectRows, error: null }).then(onfulfilled ?? undefined),
          };
          return builder;
        }
        if (table === 'courses') {
          return countableQuery([{ subject_id: 'subject-1' }, { subject_id: 'subject-1' }]);
        }
        if (table === 'academy_exams') {
          return countableQuery([{ subject_id: 'subject-2' }]);
        }
        throw new Error(`Unsupported table: ${table}`);
      },
    };

    const app = new Hono();
    app.use('/api/subjects/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      await next();
    });
    app.route('/api/subjects', subjectsRoute);

    const res = await app.request('/api/subjects');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };

    expect(body.data).toEqual([
      { id: 'subject-1', name: '數學', sortOrder: 1, courseCount: 2, academyExamCount: 0 },
      { id: 'subject-2', name: '英文', sortOrder: 2, courseCount: 0, academyExamCount: 1 },
    ]);
  });
});
