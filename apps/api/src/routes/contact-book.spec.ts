import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import contactBookApp from './contact-book';
import { toContactBookEntryResponse } from './contact-book';

/**
 * 聯絡簿是「國小模式」：每生每日唯一一則自由文字（rules 1）。
 * 見 kb/wiki/rules/contact-book-rules.md。
 */
const ROW = {
  id: 'entry-1',
  student_id: 'student-1',
  entry_date: '2026-08-29',
  content: '今天上課很專心，數學小考 95 分。',
  last_edited_by: 'user-teacher',
  signed_by: null,
  signed_at: null,
  students: { name: '陳小明' },
  editor: { name: '林老師' },
};

describe('toContactBookEntryResponse', () => {
  it('把 snake_case 的 DB 列轉成 camelCase 回應', () => {
    expect(toContactBookEntryResponse(ROW)).toEqual({
      id: 'entry-1',
      studentId: 'student-1',
      studentName: '陳小明',
      entryDate: '2026-08-29',
      content: '今天上課很專心，數學小考 95 分。',
      lastEditedByName: '林老師',
      signedBy: null,
      signedAt: null,
      isSigned: false,
    });
  });

  /**
   * 老師端要看得到家長已讀／已簽（rules 4）—— `isSigned` 是列表那一欄的資料來源，
   * 不能讓前端自己從 signedAt 推導，否則每個呼叫端都要重寫一次判斷。
   */
  it('簽收後 isSigned 為 true，並帶出誰簽的、何時簽的', () => {
    const signed = {
      ...ROW,
      signed_by: 'user-parent',
      signed_at: '2026-08-29T12:00:00Z',
    };

    const result = toContactBookEntryResponse(signed);

    expect(result.isSigned).toBe(true);
    expect(result.signedBy).toBe('user-parent');
    expect(result.signedAt).toBe('2026-08-29T12:00:00Z');
  });

  it('關聯資料缺漏時給 null，不讓回應塌成 undefined', () => {
    const bare = { ...ROW, students: null, editor: null };

    const result = toContactBookEntryResponse(bare);

    expect(result.studentName).toBeNull();
    expect(result.lastEditedByName).toBeNull();
  });
});

// ============================================================
// GET /api/contact-book/missing/summary
//
// 純函式（`lib/contact-book-missing.spec.ts`）守的是差集本身；這裡守的是**接線**：
// 三份資料有沒有按正確的日期欄位分組、以及區間守衛有沒有在碰資料庫之前就擋下來。
// 分組鍵接錯（例如拿 `session_date` 去分 `contact_book_entries`）純函式看不到。
// ============================================================

interface SummaryFixture {
  readonly candidates: Array<{ student_id: string; class_id: string; name: string }>;
  readonly entries: Array<{ student_id: string; entry_date: string }>;
  readonly sessions: Array<{ class_id: string; status: string; session_date: string }>;
}

function createSummaryApp(fixture: SummaryFixture | 'no-db') {
  const table = (rows: unknown[]) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      gte: () => query,
      lte: () => query,
      then: (onfulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null) =>
        Promise.resolve({ data: rows, error: null }).then(onfulfilled ?? undefined),
    };
    return query;
  };

  const supabase = {
    from(name: string) {
      if (fixture === 'no-db') {
        throw new Error(`區間守衛應該在碰資料庫之前就擋下來，卻查了 ${name}`);
      }
      if (name === 'enrollments') {
        return table(
          fixture.candidates.map((row) => ({
            student_id: row.student_id,
            class_id: row.class_id,
            students: { name: row.name },
            classes: { name: '數學 A', uses_contact_book: true },
          })),
        );
      }
      if (name === 'contact_book_entries') return table(fixture.entries);
      if (name === 'sessions') return table(fixture.sessions);
      throw new Error(`Unsupported table: ${name}`);
    },
  };

  const app = new Hono();
  app.use('/api/contact-book/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', 'org-1');
    context.set('userId', 'user-1');
    context.set('roles', ['admin']);
    await next();
  });
  app.route('/api/contact-book', contactBookApp);
  return app;
}

describe('GET /api/contact-book/missing/summary', () => {
  it('groups entries and sessions by their own date column', async () => {
    const app = createSummaryApp({
      candidates: [
        { student_id: 'stu-1', class_id: 'class-1', name: '王小明' },
        { student_id: 'stu-2', class_id: 'class-1', name: '李小華' },
      ],
      entries: [{ student_id: 'stu-1', entry_date: '2026-04-07' }],
      sessions: [
        { class_id: 'class-1', status: 'scheduled', session_date: '2026-04-06' },
        { class_id: 'class-1', status: 'scheduled', session_date: '2026-04-07' },
        // 04-08 停課 —— 停課那天沒有人來，也就沒有那一則要寫
        { class_id: 'class-1', status: 'cancelled', session_date: '2026-04-08' },
      ],
    });

    const response = await app.request(
      '/api/contact-book/missing/summary?dateFrom=2026-04-06&dateTo=2026-04-08',
    );
    const payload = (await response.json()) as {
      data: Array<{ date: string; missingCount: number }>;
      meta: { total: number };
    };

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([
      { date: '2026-04-06', missingCount: 2 },
      { date: '2026-04-07', missingCount: 1 },
      { date: '2026-04-08', missingCount: 0 },
    ]);
    expect(payload.meta.total).toBe(3);
  });

  it('rejects a backwards range without touching the database', async () => {
    const app = createSummaryApp('no-db');
    const response = await app.request(
      '/api/contact-book/missing/summary?dateFrom=2026-04-08&dateTo=2026-04-06',
    );

    expect(response.status).toBe(400);
  });

  it('rejects a range longer than a month without touching the database', async () => {
    const app = createSummaryApp('no-db');
    const response = await app.request(
      '/api/contact-book/missing/summary?dateFrom=2026-01-01&dateTo=2026-12-31',
    );

    expect(response.status).toBe(400);
  });
});
