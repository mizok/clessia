import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * 帳單列表的搜尋（學生姓名或家長姓名）與年級欄（#1314 帳單視覺對齊 (a)）。
 * 搜尋先解析成學生 id 再下條件；替身真的照條件過濾，別 org 的同名家長不能命中。
 */

const ORG = 'org-a';
const invoice = (id: string, studentId: string, name: string, grade: string, org = ORG) => ({
  id,
  org_id: org,
  student_id: studentId,
  issued_at: '2026-03-01',
  due_date: null,
  note: null,
  voided_at: null,
  students: { name, grade },
  invoice_items: [],
  payment_records: [],
  payment_reminders: [],
});

function seed(extraInvoices: Array<Record<string, unknown>> = []) {
  return createMultiOrgDb({
    invoices: [
      ...extraInvoices,
      invoice('i1', 's1', '王小明', 'J1'),
      invoice('i2', 's2', '李小華', 'J2'),
      invoice('i3', 's3', '張三', 'P6'),
      invoice('ix', 'sx', '王小明', 'J1', 'org-b'),
    ],
    students: [
      { id: 's1', org_id: ORG, name: '王小明' },
      { id: 's2', org_id: ORG, name: '李小華' },
      { id: 's3', org_id: ORG, name: '張三' },
      { id: 'sx', org_id: 'org-b', name: '王小明' },
    ],
    parent_student_relations: [
      { student_id: 's2', parents: { name: '王太太', org_id: ORG } },
      // 別 org 的同名家長 —— 不能讓 s3 被「王」命中
      { student_id: 's3', parents: { name: '王太太', org_id: 'org-b' } },
    ],
  });
}

/** 讓某張表的查詢一律失敗（只拿來打搜尋子查詢） */
function failing(client: unknown, table: string) {
  const base = client as { from: (t: string) => unknown };
  const broken: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => unknown) =>
              resolve({ data: null, error: { code: 'XX000', message: 'boom' } })
          : () => broken,
    },
  );
  return { from: (t: string) => (t === table ? broken : base.from(t)) };
}

async function list(
  query: string,
  campusScope: string[] | null = null,
  opts: { failTable?: string; extraInvoices?: Array<Record<string, unknown>> } = {},
) {
  const db = seed(opts.extraInvoices);
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', opts.failTable ? failing(db.client, opts.failTable) : db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(`/?${query}`);
  return {
    status: res.status,
    ...((await res.json()) as {
      data: Array<{ id: string; studentGrade: string | null }>;
      meta: { total: number };
      code?: string;
    }),
  };
}

describe('GET /invoices —— search 與 studentGrade（#1314 (a)）', () => {
  it('每列帶 studentGrade', async () => {
    const body = await list('');
    expect(Object.fromEntries(body.data.map((i) => [i.id, i.studentGrade]))).toEqual({
      i1: 'J1',
      i2: 'J2',
      i3: 'P6',
    });
  });

  it('學生姓名或本 org 家長姓名都命中；別 org 的家長與帳單不算', async () => {
    const body = await list(`search=${encodeURIComponent('王')}`);
    expect(body.data.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
    expect(body.meta.total).toBe(2);
  });

  it('推導分頁那條（status 等記憶體篩選）也吃搜尋', async () => {
    // 對照組：同條件不搜尋時三張都在 —— 證明下面的縮小是搜尋造成的
    expect((await list('status=unpaid')).data.map((i) => i.id).sort()).toEqual(['i1', 'i2', 'i3']);
    const body = await list(`search=${encodeURIComponent('李')}&status=unpaid`);
    expect(body.data.map((i) => i.id)).toEqual(['i2']);
    expect(body.meta.total).toBe(1);
  });

  it('沒命中 → 空；輸入剝光 → 空（不是不篩）', async () => {
    expect((await list(`search=${encodeURIComponent('不存在')}`)).data).toEqual([]);
    expect((await list(`search=${encodeURIComponent('%,()')}`)).data).toEqual([]);
  });

  // reviewer 二讀 #1460：查不到 ≠ 沒這個人 —— 回空清單行政會以為「沒有他的帳單」
  it.each(['students', 'parent_student_relations'])(
    '搜尋子查詢（%s）失敗 → 500，不是空清單',
    async (table) => {
      const res = await list(`search=${encodeURIComponent('王')}`, null, { failTable: table });
      expect(res.status).toBe(500);
      expect(res.code).toBe('SEARCH_FAILED');
    },
  );

  // reviewer 二讀 #1460：學生名子查詢拿掉 org 原本全綠。本 org 帳單掛著別 org 同名學生（髒資料）不能被命中
  it('別 org 的同名學生不命中', async () => {
    const res = await list(`search=${encodeURIComponent('王小明')}`, null, {
      extraInvoices: [invoice('i-dirty', 'sx', '王小明', 'J1')],
    });
    expect(res.data.map((i) => i.id)).toEqual(['i1']);
  });

  // 計畫席 10-10 裁：列表本體失敗也是 500（DB 分頁與推導分頁兩條）
  it.each(['', 'outstanding=true'])(
    '列表本體查詢失敗（%s）→ 500 LIST_FAILED，不是空清單',
    async (q) => {
      const res = await list(q, null, { failTable: 'invoices' });
      expect(res.status).toBe(500);
      expect(res.code).toBe('LIST_FAILED');
    },
  );
});
