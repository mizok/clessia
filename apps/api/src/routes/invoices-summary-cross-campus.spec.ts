import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// 假時鐘離真實日期遠：「改回真實今天」的突變才會紅
vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2027-03-15',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import invoicesRoute from './invoices';

/**
 * `GET /api/invoices/summary` 的 `crossCampusOverdue`（#1314 儀表板「另有 N 張跨校帳單」）。
 * 定義：授權範圍內看得到 ∧ 被 `campusId` 篩選排除 ∧ 有班的明細也落在篩選範圍內 ∧ 逾期。
 *
 * `multi-org-db` 不解析 select，帳單列直接帶 `INVOICE_SCOPE_EMBED` 的 alias 欄位。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';
const CC = '00000000-0000-0000-0000-0000000000cc';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const YESTERDAY = '2027-03-14';
const TODAY = '2027-03-15';

const campusOfClass = (campus: string | null) =>
  campus ? { classes: { campus_id: campus } } : null;

/** 學生在 A、B、C 三校都有報名；明細只給班的分校（null＝餐費） */
function invoice(
  n: number,
  itemCampuses: Array<string | null>,
  over: Record<string, unknown> = {},
) {
  return {
    id: id(n),
    org_id: ORG,
    student_id: id(100),
    issued_at: '2027-03-01',
    due_date: YESTERDAY,
    voided_at: null,
    invoice_items: itemCampuses.map(() => ({ amount: '1000' })),
    payment_records: [] as Array<{ kind: string; amount: string }>,
    scope_student: { enrollments: [CA, CB, CC].map(campusOfClass) },
    scope_items: itemCampuses.map((campus) => ({ enrollments: campusOfClass(campus) })),
    ...over,
  };
}

async function crossCount(
  invoices: Array<Record<string, unknown>>,
  opts: { scope?: string[] | null; campusId?: string } = {},
) {
  const db = createMultiOrgDb({ invoices });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', opts.scope ?? null);
    await next();
  });
  app.route('/', invoicesRoute as unknown as Hono);
  const res = await app.request(`/summary${opts.campusId ? `?campusId=${opts.campusId}` : ''}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { crossCampusOverdue: { count: number } };
  return body.crossCampusOverdue.count;
}

describe('GET /api/invoices/summary —— crossCampusOverdue（#1314 儀表板）', () => {
  const cross = invoice(1, [CA, CB]);

  it('A＋B 跨校逾期單：選 A、選 B 各 1；選 C（沒沾到）0', async () => {
    expect(await crossCount([cross], { campusId: CA })).toBe(1);
    expect(await crossCount([cross], { campusId: CB })).toBe(1);
    expect(await crossCount([cross], { campusId: CC })).toBe(0);
  });

  it('沒帶 campusId 恆 0（不論受不受限）', async () => {
    expect(await crossCount([cross])).toBe(0);
    expect(await crossCount([cross], { scope: [CA] })).toBe(0);
  });

  it('受限 [A] 選 A：A＋B 單他本來就看不到，不回張數（不是側管道）', async () => {
    expect(await crossCount([cross], { scope: [CA], campusId: CA })).toBe(0);
  });

  it('受限 [A,B] 選 A：看得到、被篩掉 → 1', async () => {
    expect(await crossCount([cross], { scope: [CA, CB], campusId: CA })).toBe(1);
  });

  it('別 org 的跨校逾期單不進', async () => {
    expect(await crossCount([invoice(2, [CA, CB], { org_id: OTHER_ORG })], { campusId: CA })).toBe(
      0,
    );
  });

  it('只有 A 明細：選 B 被排除但沒沾到 B → 0；選 A 時看得到 → 0', async () => {
    const onlyA = invoice(3, [CA]);
    expect(await crossCount([onlyA], { campusId: CB })).toBe(0);
    expect(await crossCount([onlyA], { campusId: CA })).toBe(0);
  });

  it('純餐費（跨校學生）：兩校都看得到、不算被排除 → 0', async () => {
    expect(await crossCount([invoice(4, [null])], { campusId: CA })).toBe(0);
  });

  it('跨校單＋餐費明細：仍是跨校單 → 1', async () => {
    expect(await crossCount([invoice(5, [CA, CB, null])], { campusId: CA })).toBe(1);
  });

  it('逾期邊界：到期日今天不算、昨天算；沒有到期日不算', async () => {
    expect(await crossCount([invoice(6, [CA, CB], { due_date: TODAY })], { campusId: CA })).toBe(0);
    expect(await crossCount([invoice(7, [CA, CB], { due_date: null })], { campusId: CA })).toBe(0);
  });

  it('已繳清、作廢的跨校逾期單不算；部分繳仍算', async () => {
    const paid = invoice(8, [CA, CB], { payment_records: [{ kind: 'payment', amount: '2000' }] });
    const voided = invoice(9, [CA, CB], { voided_at: '2027-03-02T00:00:00Z' });
    const partial = invoice(10, [CA, CB], {
      payment_records: [{ kind: 'payment', amount: '500' }],
    });
    expect(await crossCount([paid, voided], { campusId: CA })).toBe(0);
    expect(await crossCount([partial], { campusId: CA })).toBe(1);
  });

  it('跨校單不進所選分校的 overdue（N 與卡片數字互補，不重複）', async () => {
    const db = createMultiOrgDb({ invoices: [cross, invoice(11, [CA])] });
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', ORG);
      set('campusScope', null);
      await next();
    });
    app.route('/', invoicesRoute as unknown as Hono);
    const body = (await (await app.request(`/summary?campusId=${CA}`)).json()) as {
      overdue: { count: number };
      crossCampusOverdue: { count: number };
    };
    expect(body.overdue.count).toBe(1);
    expect(body.crossCampusOverdue.count).toBe(1);
  });
});
