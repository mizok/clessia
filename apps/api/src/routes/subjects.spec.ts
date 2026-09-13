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
  const auditRows: Array<Record<string, unknown>> = [];

  const supabase = {
    from(table: string) {
      if (table === 'courses') return countableQuery(fixture.courseRows);
      if (table === 'academy_exams') return countableQuery(fixture.examRows);
      if (table === 'subjects') {
        return {
          // #828 起 delete 之前會先讀名字（稽核要記得刪掉的是哪一個）
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: { name: '數學' }, error: null }) }),
          }),
          delete: () => ({
            eq: () => {
              subjectDeleted = true;
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      // `logAudit` 會查 profiles 再寫 audit_logs。**這兩張表回最小可用的東西而不是
      // 丟例外** —— 丟例外的話 logAudit 會在它自己的 try/catch 裡靜默失敗，
      // 於是「有沒有寫稽核」在這組 fixture 裡永遠不可觀察（leaves.spec 的同一個坑）。
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: (payload: Record<string, unknown>) => {
            auditRows.push(payload);
            return Promise.resolve({ error: null });
          },
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
    context.set('userId', 'user-1');
    await next();
  });
  app.route('/api/subjects', subjectsRoute);

  return { app, wasSubjectDeleted: () => subjectDeleted, auditRows };
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

/**
 * **#828：科目的三顆寫入鈕完全沒有 `audit_logs`** ——
 * #758 第 1 輪逐顆實按查 DB 對照：分校 5 筆、學校 3 筆、**科目 0 筆**。
 *
 * ⚠️ **這組測試證明的是「接線存在」，不是「DB 真的收下那一筆」。**
 * `audit_logs.resource_type` 有 CHECK constraint，而 `subject` 是這一輪
 * 新加進去的（`20260913101500` 那支 migration）——
 * **CHECK 擋掉的話 `logAudit` 只會在它自己的 try/catch 裡印一行，測試照樣綠。**
 * 那一半只能靠實按或本機 PostgREST 驗。
 */
describe('DELETE /api/subjects/:id —— 稽核紀錄（#828）', () => {
  it('刪除成功時寫一筆 audit_logs，記得刪掉的是哪一個科目', async () => {
    const { app, auditRows } = createDeleteTestApp({ courseRows: [], examRows: [] });

    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    // `logAudit` 是 fire-and-forget（waitUntil 包住），讓它的 microtask 跑完
    await Promise.resolve();
    await Promise.resolve();

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      resource_type: 'subject',
      resource_id: SUBJECT_ID,
      // **刪之前讀的名字** —— 刪完就查不到了
      resource_name: '數學',
      // 裸 action，不是 'subject.delete'（#828 的收斂）
      action: 'delete',
    });
  });

  // 反向對照：被擋下來的刪除不該留稽核紀錄（沒發生的事不要記）
  it('因為有課程在用而被擋時，不寫 audit_logs', async () => {
    const { app, auditRows } = createDeleteTestApp({
      courseRows: [{ subject_id: SUBJECT_ID }],
      examRows: [],
    });

    const res = await app.request(`/api/subjects/${SUBJECT_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    await Promise.resolve();
    await Promise.resolve();

    expect(auditRows).toHaveLength(0);
  });
});
