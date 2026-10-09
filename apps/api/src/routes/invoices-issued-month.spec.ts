import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-20',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * `GET /api/invoices?issuedMonth=YYYY-MM`（#1314 P4 匯出）：開立月（`issued_at` 是台北日期的 date 欄），
 * 同彙總「本月」的定義。匯出面板的三個範圍對到既有參數：全部／`overdue`／`outstanding`。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const invoice = (n: number, issuedAt: string, over: Record<string, unknown> = {}) => ({
  id: id(n),
  org_id: ORG,
  student_id: id(900),
  issued_at: issuedAt,
  due_date: '2026-10-31',
  voided_at: null,
  note: null,
  created_at: `${issuedAt}T00:00:00Z`,
  updated_at: `${issuedAt}T00:00:00Z`,
  students: { name: '甲' },
  invoice_items: [{ id: id(n * 10), type: 'tuition', enrollment_id: null, amount: '1000' }],
  payment_records: [],
  // 分校範圍的 alias embed（multi-org-db 不解析 select，直接帶）
  scope_student: { enrollments: [{ classes: { campus_id: CA } }] },
  scope_items: [{ enrollments: null }],
  ...over,
});

function seed() {
  return createMultiOrgDb({
    invoices: [
      invoice(1, '2026-09-30'), // 上個月最後一天：不進
      invoice(2, '2026-10-01'), // 月初：進
      invoice(3, '2026-10-31', {
        payment_records: [{ id: id(31), kind: 'payment', amount: '1000' }],
      }), // 月底、繳清
      invoice(4, '2026-10-15', { due_date: '2026-10-10' }), // 逾期
      invoice(5, '2026-11-01'), // 下個月 1 號：不進
      invoice(6, '2026-10-05', { org_id: OTHER }), // 別 org
      invoice(7, '2026-10-06', {
        scope_student: { enrollments: [{ classes: { campus_id: CB } }] },
      }), // 只在 B 校的學生
      invoice(8, '2026-12-31'), // 十二月底：12 月進
      invoice(9, '2027-01-01'), // 隔年 1 號：12 月不進
    ],
  });
}

async function get(path: string, scope: readonly string[] | null = null) {
  const db = seed();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

const ids = (body: any) => body.data.map((r: { id: string }) => r.id).sort();

describe('GET /api/invoices?issuedMonth（#1314 P4）', () => {
  it('月初進、月底進；上月底與下月 1 號不進；別 org 不進', async () => {
    const { status, body } = await get('/?issuedMonth=2026-10&pageSize=200');
    expect(status).toBe(200);
    expect(ids(body)).toEqual([id(2), id(3), id(4), id(7)]);
    expect(body.meta.total).toBe(4);
  });

  it('十二月跨年：下個月是隔年一月', async () => {
    const { body } = await get('/?issuedMonth=2026-09');
    expect(ids(body)).toEqual([id(1)]);
    const dec = await get('/?issuedMonth=2026-12');
    expect(dec.status).toBe(200);
    expect(ids(dec.body)).toEqual([id(8)]);
  });

  it('與 overdue／outstanding 是 AND', async () => {
    expect(ids((await get('/?issuedMonth=2026-10&overdue=true')).body)).toEqual([id(4)]);
    expect(ids((await get('/?issuedMonth=2026-10&outstanding=true')).body)).toEqual([
      id(2),
      id(4),
      id(7),
    ]);
  });

  it('受限者照套分校範圍', async () => {
    const { body } = await get('/?issuedMonth=2026-10', [CA]);
    expect(ids(body)).toEqual([id(2), id(3), id(4)]);
  });

  it('格式不對 → 400', async () => {
    for (const bad of ['2026-13', '2026-1', '2026-10-01', 'oct']) {
      expect((await get(`/?issuedMonth=${bad}`)).status).toBe(400);
    }
  });
});
