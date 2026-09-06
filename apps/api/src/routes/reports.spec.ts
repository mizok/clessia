import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import reportsRoute from './reports';

/**
 * `GET /api/reports/revenue` 的三條守衛（#522）。
 *
 * **這不是給 reports 補齊測試** —— 它刻意只釘三條，每條都對應一個**已經發生過或
 * 已知會發生**的改動方向：
 *
 * 1. **基準日是台北不是 UTC**（#421 動過這裡；#402 那族的 bug 只在台北凌晨那 8 小時發作）
 * 2. **分校範圍真的把別校的錢擋掉**（#209 接的分校過濾）
 * 3. **到期日當天不算逾期**（#440 抽走逾期判定時發現既有 `revenue-report.spec`
 *    對這個突變是綠的 —— 同一個缺口在這一層補上）
 *
 * 這支路由在此之前**零 spec，而它今天被改過三次**，其中兩次直接決定報表上的數字。
 *
 * ## 為什麼第 2 條斷言的是回應而不是查詢形狀
 *
 * 工單指定「斷言送出去的查詢形狀」，那個做法是為了對付「替身不套 `.in()` 所以
 * 回傳值沒有鑑別力」。**但 `reports.ts` 的分校過濾根本不在查詢裡** ——
 * 它撈完之後用 `matchesFilter()`（reports.ts:96-112）在記憶體篩。
 * 所以這裡回應**本來就有鑑別力**：替身照樣回兩校的資料，被擋掉的那筆不會出現在數字裡。
 * 斷言查詢形狀在這支反而驗不到東西（查詢裡沒有分校條件可看）。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const CAMPUS_MINE = '00000000-0000-0000-0000-0000000000c1';
const CAMPUS_THEIRS = '00000000-0000-0000-0000-0000000000c2';

interface InvoiceFixture {
  id: string;
  issuedAt: string;
  dueDate: string | null;
  amount: number;
  paid: number;
  campusId: string;
  campusName: string;
}

function invoiceRow(f: InvoiceFixture) {
  return {
    id: f.id,
    issued_at: f.issuedAt,
    due_date: f.dueDate,
    invoice_items: [
      {
        amount: f.amount,
        enrollments: {
          classes: {
            campus_id: f.campusId,
            course_id: 'course-1',
            campuses: { name: f.campusName },
            courses: { name: '數學' },
          },
        },
      },
    ],
    payment_records: f.paid > 0 ? [{ kind: 'payment', amount: f.paid }] : [],
  };
}

/**
 * 這支 handler 打兩支查詢（`payment_records` 與 `invoices`），各自
 * `select().eq().gte().lte()` 之後被 await。替身照表回資料，**不模擬任何過濾** ——
 * 分校那條是在應用層篩的，替身照實回全部才驗得到它有沒有真的擋掉。
 */
function fakeSupabase(invoices: ReturnType<typeof invoiceRow>[]) {
  const make = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    Object.assign(builder, {
      select: () => chain(),
      eq: () => chain(),
      gte: () => chain(),
      lte: () => chain(),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    });
    return builder;
  };

  return {
    from: (table: string) => (table === 'invoices' ? make(invoices) : make([])),
  };
}

function appWith(invoices: ReturnType<typeof invoiceRow>[], campusScope: string[] | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', fakeSupabase(invoices));
    set('orgId', ORG);
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', reportsRoute as unknown as Hono);

  return app;
}

interface Figures {
  received: number;
  refunded: number;
  billed: number;
  outstanding: number;
  overdueOutstanding: number;
}

async function revenue(
  invoices: ReturnType<typeof invoiceRow>[],
  campusScope: string[] | null = null,
) {
  const res = await appWith(invoices, campusScope).request(
    '/revenue?dateFrom=2026-09-01&dateTo=2026-09-30',
  );
  expect(res.status).toBe(200);

  return (await res.json()) as { summary: Figures; groups: Array<Figures & { key: string }> };
}

describe('GET /api/reports/revenue —— 逾期分類的基準日是台北，不是 UTC', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * 台北 2026-09-06 01:00 = UTC 2026-09-05 17:00 —— #402 出事的那個窗。
   * 到期日 09-05 在**台北的今天（09-06）**看是「已經過了」，在 **UTC 的今天（09-05）**
   * 看是「今天到期、還沒過」。**兩種算法在這裡給出相反的答案**，而報表上的差別是
   * 「這筆錢算不算逾期未收」—— 行政據此決定要不要打電話催繳。
   */
  it('台北凌晨那個窗：昨天到期的帳單算逾期，用 UTC 算會漏掉它', async () => {
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

    const body = await revenue([
      invoiceRow({
        id: 'inv-1',
        issuedAt: '2026-09-01',
        dueDate: '2026-09-05',
        amount: 10000,
        paid: 0,
        campusId: CAMPUS_MINE,
        campusName: '中正分校',
      }),
    ]);

    expect(body.summary.outstanding).toBe(10000);
    expect(body.summary.overdueOutstanding).toBe(10000);

    // 對照：naive 的 UTC 算法在這一刻是 09-05，而 '2026-09-05' < '2026-09-05' 是 false
    // —— 那條路會回 0，也就是這筆錢不會出現在逾期未收裡
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-05');
  });
});

describe('GET /api/reports/revenue —— 分校範圍要把別校的錢擋在報表外', () => {
  /**
   * 受限管理員（只管中正分校）的報表**不能包含大安分校的金額**。
   * `matchesFilter` 的範圍判準跟篩選相反：篩選是「沾到就算」，範圍是「沾到就不能看」
   * （reports.ts:105-110）—— 一張帳單只要有任何一筆明細在範圍外就整張看不到，
   * 否則跨校帳單會變成看見別校金額的側管道。
   */
  it('只管中正分校的人看不到大安分校的帳單金額', async () => {
    const body = await revenue(
      [
        invoiceRow({
          id: 'inv-mine',
          issuedAt: '2026-09-01',
          dueDate: '2026-09-30',
          amount: 10000,
          paid: 0,
          campusId: CAMPUS_MINE,
          campusName: '中正分校',
        }),
        invoiceRow({
          id: 'inv-theirs',
          issuedAt: '2026-09-01',
          dueDate: '2026-09-30',
          amount: 77000,
          paid: 0,
          campusId: CAMPUS_THEIRS,
          campusName: '大安分校',
        }),
      ],
      [CAMPUS_MINE],
    );

    // 替身照實回了兩張帳單 —— 被擋掉是應用層的事，所以這個數字有鑑別力
    expect(body.summary.billed).toBe(10000);
    expect(body.groups.map((g) => g.key)).toEqual(['中正分校']);
  });

  it('不受分校限制的管理員兩校都看得到（確認上一條不是無腦擋）', async () => {
    const body = await revenue(
      [
        invoiceRow({
          id: 'inv-mine',
          issuedAt: '2026-09-01',
          dueDate: '2026-09-30',
          amount: 10000,
          paid: 0,
          campusId: CAMPUS_MINE,
          campusName: '中正分校',
        }),
        invoiceRow({
          id: 'inv-theirs',
          issuedAt: '2026-09-01',
          dueDate: '2026-09-30',
          amount: 77000,
          paid: 0,
          campusId: CAMPUS_THEIRS,
          campusName: '大安分校',
        }),
      ],
      null,
    );

    expect(body.summary.billed).toBe(87000);
  });
});

describe('GET /api/reports/revenue —— 到期日當天還沒逾期', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * `billing-rules.md:63` 的原話是「**過了** `due_date` 未繳清」——當天還沒過。
   *
   * **這條在 #440 補過一次，但補在 `lib/invoice-overdue.ts` 那一層。**
   * 那次的突變驗證順帶發現：既有的 `revenue-report.spec` 對「`<` 改成 `<=`」是**綠的**
   * （它沒有「到期日當天」的案例）。這裡把同一個邊界釘在**路由這一層**，
   * 因為路由決定的是「哪一天當基準日」，而那是另一個可以獨立出錯的決定。
   */
  it('到期日就是今天時，算未收但不算逾期', async () => {
    vi.setSystemTime(new Date('2026-09-05T17:00:00Z')); // 台北 09-06

    const body = await revenue([
      invoiceRow({
        id: 'inv-due-today',
        issuedAt: '2026-09-01',
        dueDate: '2026-09-06',
        amount: 5000,
        paid: 0,
        campusId: CAMPUS_MINE,
        campusName: '中正分校',
      }),
    ]);

    expect(body.summary.outstanding).toBe(5000);
    expect(body.summary.overdueOutstanding).toBe(0);
  });
});
