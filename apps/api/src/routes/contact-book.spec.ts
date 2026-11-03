import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import contactBookApp, { ALL_CLASSES, toContactBookEntryResponse } from './contact-book';
import { createMultiOrgDb } from '../test-utils/multi-org-db';

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
  updated_at: '2026-08-29T10:00:00Z',
  teacher_edited_at: '2026-08-29T09:30:00Z',
  students: { name: '陳小明' },
  editor: { name: '林老師' },
  signer: null,
};

describe('toContactBookEntryResponse', () => {
  it('把 snake_case 的 DB 列轉成 camelCase 回應', () => {
    expect(toContactBookEntryResponse(ROW, ALL_CLASSES)).toEqual({
      id: 'entry-1',
      studentId: 'student-1',
      studentName: '陳小明',
      entryDate: '2026-08-29',
      content: '今天上課很專心，數學小考 95 分。',
      lastEditedByName: '林老師',
      teacherEditedAt: '2026-08-29T09:30:00Z',
      signedBy: null,
      signedByName: null,
      signedAt: null,
      isSigned: false,
      editedAfterSign: false,
      classNames: [],
    });
  });

  /** #1100 #26：簽收保留，但簽收之後又改過要標出來。簽收時兩欄相等（同一個交易時間） */
  it('updated_at 晚於 signed_at → editedAfterSign；相等（剛簽收）→ false', () => {
    const at = '2026-08-29T12:00:00.123456+00:00';
    const signedNow = { ...ROW, signed_at: at, updated_at: at };
    expect(toContactBookEntryResponse(signedNow, ALL_CLASSES).editedAfterSign).toBe(false);
    const editedLater = { ...signedNow, updated_at: '2026-08-29T12:05:00+00:00' };
    expect(toContactBookEntryResponse(editedLater, ALL_CLASSES).editedAfterSign).toBe(true);
  });

  /**
   * 老師端要看得到家長已讀／已簽（rules 4）—— `isSigned` 是列表那一欄的資料來源，
   * 不能讓前端自己從 signedAt 推導，否則每個呼叫端都要重寫一次判斷。
   */
  it('簽收後 isSigned 為 true，並帶出誰簽的、何時簽的', () => {
    const signed = {
      ...ROW,
      signed_by: 'user-parent',
      signer: { name: '林太太' },
      signed_at: '2026-08-29T12:00:00Z',
    };

    const result = toContactBookEntryResponse(signed, ALL_CLASSES);

    expect(result.isSigned).toBe(true);
    expect(result.signedBy).toBe('user-parent');
    expect(result.signedByName).toBe('林太太');
    expect(result.signedAt).toBe('2026-08-29T12:00:00Z');
  });

  /**
   * #2080-1 列的班名（計畫席 11-02 裁定）：報名中（active／pending_payment）、班級開了聯絡簿、
   * 在範圍內（分校範圍；老師只看現任的班），依班名排序。一則聯絡簿屬於學生不屬於班（rules §1），
   * 所以是「這位學生現在在哪些開聯絡簿的班」。
   */
  describe('classNames（#2080-1）', () => {
    const enr = (
      name: string,
      over: Record<string, unknown> = {},
      cls: Record<string, unknown> = {},
    ) => ({
      status: 'active',
      class_id: `class-${name}`,
      classes: { name, campus_id: 'campus-a', uses_contact_book: true, ...cls },
      ...over,
    });
    const withEnrollments = (enrollments: unknown[]) => ({
      ...ROW,
      students: { name: '陳小明', enrollments },
    });

    it('只算報名中、開了聯絡簿的班；依班名排序、不重複', () => {
      const row = withEnrollments([
        enr('三年乙班'),
        enr('三年甲班', { status: 'pending_payment' }),
        enr('已退的班', { status: 'withdrawal' }),
        enr('暫停的班', { status: 'suspended' }),
        enr('國中數學', {}, { uses_contact_book: false }),
        enr('三年乙班', { class_id: 'class-dup' }),
      ]);
      expect(toContactBookEntryResponse(row, ALL_CLASSES).classNames).toEqual([
        '三年乙班',
        '三年甲班',
      ]);
    });

    it('分校範圍：範圍外分校的班不列（跨校學生只露出範圍內的班名）', () => {
      const row = withEnrollments([
        enr('A 校的班'),
        enr('B 校的班', {}, { campus_id: 'campus-b' }),
      ]);
      const visible = { campusIds: ['campus-a'], classIds: null };
      expect(toContactBookEntryResponse(row, visible).classNames).toEqual(['A 校的班']);
    });

    it('老師：只列自己現任的班', () => {
      const row = withEnrollments([enr('我的班'), enr('別人的班')]);
      const visible = { campusIds: null, classIds: ['class-我的班'] };
      expect(toContactBookEntryResponse(row, visible).classNames).toEqual(['我的班']);
    });

    it('沒有報名資料（embed 沒帶或缺漏）→ 空陣列', () => {
      expect(
        toContactBookEntryResponse({ ...ROW, students: null }, ALL_CLASSES).classNames,
      ).toEqual([]);
    });
  });

  it('關聯資料缺漏時給 null，不讓回應塌成 undefined', () => {
    const bare = { ...ROW, students: null, editor: null, signer: null };

    const result = toContactBookEntryResponse(bare, ALL_CLASSES);

    expect(result.studentName).toBeNull();
    expect(result.lastEditedByName).toBeNull();
    expect(result.signedByName).toBeNull();
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
    // 正式由 authMiddleware 設；不受分校限制（#1994 起這三支 GET 會讀它）
    context.set('campusScope', null);
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

/**
 * #1100 #26（計畫席 10-23）：內容沒變就不寫。upsert 會讓 trigger 跳 `updated_at`，
 * 老師原文照存一次，已簽收的那則就會變成「簽收後有修改」。
 */
describe('PUT /api/contact-book 內容沒變不寫', () => {
  const ORG = 'org-1';
  const STUDENT = '00000000-0000-0000-0000-000000000031';
  const DATE = '2026-10-20';

  function setup() {
    const db = createMultiOrgDb({
      students: [{ id: STUDENT, org_id: ORG, name: '甲' }],
      contact_book_entries: [
        {
          id: 'e1',
          org_id: ORG,
          student_id: STUDENT,
          entry_date: DATE,
          content: '原文',
          last_edited_by: 'teacher-a',
          signed_at: '2026-10-20T12:00:00Z',
          updated_at: '2026-10-20T12:00:00Z',
        },
      ],
    });
    const writes: string[] = [];
    const client = db.client as { from: (t: string) => Record<string, unknown> };
    const from = client.from.bind(client);
    client.from = (t: string) => {
      const q = from(t);
      for (const op of ['upsert', 'update', 'insert']) {
        const orig = (q[op] as (...a: unknown[]) => unknown).bind(q);
        q[op] = (...a: unknown[]) => {
          if (t === 'contact_book_entries') writes.push(op);
          return orig(...a);
        };
      }
      return q;
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', ORG);
      set('userId', 'admin-b');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', contactBookApp as unknown as Hono);
    const put = (content: string) =>
      app.request('/', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: STUDENT, entryDate: DATE, content }),
      });
    return { db, writes, put };
  }

  it('原文照存：不寫、編輯者不換，回現狀', async () => {
    const { db, writes, put } = setup();
    const res = await put('原文');
    expect(res.status).toBe(200);
    expect(writes).toEqual([]);
    expect(db.rows('contact_book_entries')[0]).toMatchObject({ last_edited_by: 'teacher-a' });
    // 沒人改內容 → 「老師最後編輯」也不能跳（#2080-3）
    expect(db.rows('contact_book_entries')[0]['teacher_edited_at']).toBeUndefined();
  });

  it('內容改了：照寫（防過度擋）', async () => {
    const { db, writes, put } = setup();
    expect((await put('改過的內容')).status).toBe(200);
    expect(writes).toEqual(['upsert']);
    expect(db.rows('contact_book_entries')[0]).toMatchObject({
      content: '改過的內容',
      last_edited_by: 'admin-b',
    });
  });

  it('內容改了：寫 teacher_edited_at，並回給前端（#2080-3）', async () => {
    const { db, put } = setup();
    const before = Date.now();
    const body = (await (await put('改過的內容')).json()) as { teacherEditedAt: string | null };
    const written = db.rows('contact_book_entries')[0]['teacher_edited_at'] as string;
    expect(Date.parse(written)).toBeGreaterThanOrEqual(before);
    expect(body.teacherEditedAt).toBe(written);
  });
});
