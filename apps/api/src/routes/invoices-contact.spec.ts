import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-08',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * #1625 快速聯絡家長：**單張**帳單帶這位學生的家長聯絡方式與匯款資料。
 * 授權跟著帳單走 —— 帳單過了 `findScopedInvoice`（org＋分校範圍）才讀家長；範圍外 404，什麼都不給。
 * 列表**不帶**（一次幾百張，不該順便帶出幾百位家長的個資，計畫席 gate）。
 *
 * `multi-org-db` 不解析 select，embed 直接寫在列上（同 `invoices-campus-scope.spec.ts`）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SA = id(101);
const SB = id(102);
const IN_A = id(1); // A 校學生、A 班
const IN_B = id(2); // B 校學生、B 班
const DOMAIN = 'phone.internal';

const cls = (campus: string) => ({ classes: { campus_id: campus } });

function invoice(n: number, student: string, campus: string) {
  return {
    id: id(n),
    org_id: ORG,
    invoice_no: `INV-${n}`,
    student_id: student,
    issued_at: '2026-10-01',
    due_date: '2026-10-15',
    voided_at: null,
    note: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    students: { name: student === SA ? '王小明' : '李小華', grade: 'J1' },
    invoice_items: [
      { id: id(n * 10), type: 'tuition', enrollment_id: id(900 + n), amount: '4500' },
    ],
    payment_records: [],
    scope_student: { enrollments: [cls(campus)] },
    scope_items: [{ enrollments: cls(campus) }],
  };
}

function seed() {
  const invoices = [invoice(1, SA, CA), invoice(2, SB, CB)];
  return createMultiOrgDb({
    invoices,
    invoice_items: invoices.flatMap((inv) =>
      inv.invoice_items.map((it) => ({ ...it, invoice_id: inv.id })),
    ),
    payment_records: [],
    payment_reminders: [],
    students: [
      { id: SA, org_id: ORG, name: '王小明', enrollments: [cls(CA)] },
      { id: SB, org_id: ORG, name: '李小華', enrollments: [cls(CB)] },
    ],
    parent_student_relations: [
      {
        id: id(301),
        student_id: SA,
        relation: '母親',
        is_primary: true,
        parents: { id: id(401), name: '王媽媽', user_id: 'u-mom' },
      },
      {
        id: id(302),
        student_id: SA,
        relation: '父親',
        is_primary: false,
        parents: { id: id(402), name: '王爸爸', user_id: 'u-dad' },
      },
      {
        id: id(303),
        student_id: SB,
        relation: '母親',
        is_primary: true,
        parents: { id: id(403), name: '李媽媽', user_id: 'u-lee' },
      },
    ],
    ba_user: [
      // 只留電話：email 是系統產的 placeholder，要當成「沒有留 email」
      { id: 'u-mom', email: `0912345678@${DOMAIN}`, phone: '0912345678' },
      // 沒有留電話：照樣要列出來，不能整列消失
      { id: 'u-dad', email: 'dad@example.com', phone: null },
      { id: 'u-lee', email: 'lee@example.com', phone: '0922000111' },
    ],
    campuses: [
      { id: CA, org_id: ORG, name: '總校', payment_info: '總校帳戶 012-3456' },
      { id: CB, org_id: ORG, name: '二校', payment_info: '' },
    ],
    organizations: [{ id: ORG, invoice_due_days: 14, payment_info: '機構帳戶 999-0000' }],
  });
}

/** 指定那張表的查詢一律回 error（其餘照常）—— 守「讀不到不能裝成沒有」 */
function failingOn(client: unknown, table: string): unknown {
  const result = { data: null, error: { message: 'boom' } };
  const chain: unknown = new Proxy(() => undefined, {
    get: (_t, key) =>
      key === 'then' ? (resolve: (v: unknown) => void) => resolve(result) : () => chain,
  });
  const real = client as { from: (t: string) => unknown };
  return new Proxy(real, {
    get: (target, key) =>
      key === 'from'
        ? (name: string) => (name === table ? chain : target.from(name))
        : Reflect.get(target, key),
  });
}

async function call(path: string, scope: readonly string[] | null = [CA], failTable?: string) {
  const db = seed();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', failTable ? failingOn(db.client, failTable) : db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['manage_finance']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(path, {}, { PLACEHOLDER_EMAIL_DOMAIN: DOMAIN });
  return { status: res.status, body: (await res.json()) as any };
}

describe('單張帳單帶家長聯絡方式（#1625）', () => {
  it('範圍內：列出學生的所有家長（姓名、關係、電話、email）；placeholder email 當成沒有留', async () => {
    const { status, body } = await call(`/${IN_A}`);
    expect(status).toBe(200);
    expect(body.data.parents).toEqual([
      {
        id: id(401),
        name: '王媽媽',
        relation: '母親',
        phone: '0912345678',
        email: null,
        isPrimary: true,
      },
      {
        id: id(402),
        name: '王爸爸',
        relation: '父親',
        phone: null,
        email: 'dad@example.com',
        isPrimary: false,
      },
    ]);
  });

  it('匯款資料：分校覆寫優先', async () => {
    const { body } = await call(`/${IN_A}`);
    expect(body.data.paymentInfo).toEqual([{ campusName: null, text: '總校帳戶 012-3456' }]);
  });

  it('分校沒設定（空字串）：退回機構預設', async () => {
    const { body } = await call(`/${IN_B}`, null);
    expect(body.data.paymentInfo).toEqual([{ campusName: null, text: '機構帳戶 999-0000' }]);
  });

  // 保留類的突變守點：拿掉 findScopedInvoice 的範圍判斷，這條會拿到李媽媽的電話而轉紅
  it('範圍外的帳單：404，拿不到任何家長聯絡方式', async () => {
    const { status, body } = await call(`/${IN_B}`, [CA]);
    expect(status).toBe(404);
    expect(JSON.stringify(body)).not.toContain('0922000111');
    expect(JSON.stringify(body)).not.toContain('lee@example.com');
  });

  // #1625 計畫席擋點：任一支讀不到就 500，不能回「沒有家長／沒有留電話」騙人
  it.each(['parent_student_relations', 'ba_user', 'campuses', 'organizations'])(
    '%s 讀不到 → 500，不回空的家長清單',
    async (table) => {
      const { status, body } = await call(`/${IN_A}`, [CA], table);
      expect(status).toBe(500);
      expect(body).not.toHaveProperty('data');
    },
  );

  it('列表不帶家長聯絡方式與匯款資料', async () => {
    const { status, body } = await call('/', null);
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row).not.toHaveProperty('parents');
      expect(row).not.toHaveProperty('paymentInfo');
    }
    expect(JSON.stringify(body)).not.toContain('0912345678');
  });
});
