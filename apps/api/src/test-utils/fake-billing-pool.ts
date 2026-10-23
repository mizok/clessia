/**
 * 帳務作業（`routes/billing-runs.ts` POST）單元測試用的 pg pool 替身（#1943）。
 *
 * 開帳的寫入改成每位學生一筆經 pool 的交易，SQL 不經 supabase-js。這個替身**依語句辨認**
 * 帳務作業會下的那幾句，讀的時候從同一份 supabase 替身的列算（`rows`），寫的時候也寫回那份替身
 * （`client`）—— 所以原本斷言「哪些學生被開、哪些餐被蓋章」的測試照樣有意義。
 *
 * **SQL 語意（org 條件、FOR UPDATE、unnest、CTE）這裡驗不出來**，那些由
 * `contract/billing-run-scale.contract.ts` 對真 Postgres 驗。這裡只驗路由的接線與分支。
 * 認不得的語句直接丟錯，免得新加的 SQL 被靜靜吞掉。
 */

type Row = Record<string, unknown>;

interface SupabaseLike {
  from(table: string): Record<string, (...args: unknown[]) => unknown>;
}

export interface FakeBillingPool {
  readonly query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  readonly connect: () => Promise<{
    query: FakeBillingPool['query'];
    release: (err?: unknown) => void;
  }>;
  readonly end: () => Promise<void>;
  /** 每一句經過 pool 的 SQL（含 BEGIN／COMMIT／ROLLBACK） */
  readonly statements: string[];
}

export function fakeBillingPool(opts: {
  readonly rows: (table: string) => readonly Row[];
  readonly client: SupabaseLike;
  /** 讓某一句失敗（測讀取／寫入失敗） */
  readonly fail?: (sql: string, params: unknown[]) => boolean;
}): FakeBillingPool {
  const statements: string[] = [];
  let seq = 0;
  const run = async (q: unknown) => (await (q as PromiseLike<{ data: unknown }>)).data;

  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
    statements.push(sql.trim().split('\n')[0]!);
    if (opts.fail?.(sql, params)) {
      throw Object.assign(new Error('fake pool：注入的錯誤'), { code: 'XX000' });
    }
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };

    if (sql.includes('select distinct ii.enrollment_id')) {
      // 學費冪等：這些報名在這個週期開在有效帳單上的
      const [, enrollmentIds, periodMonth, billingPeriodId] = params as [
        string,
        string[],
        string | null,
        string | null,
      ];
      const voided = new Set(
        opts
          .rows('invoices')
          .filter((i) => i['voided_at'])
          .map((i) => i['id']),
      );
      const billed = opts
        .rows('invoice_items')
        .filter(
          (ii) =>
            ii['type'] === 'tuition' &&
            enrollmentIds.includes(ii['enrollment_id'] as string) &&
            !voided.has(ii['invoice_id']) &&
            !((ii['invoices'] as Row | undefined)?.['voided_at'] ?? null) &&
            (periodMonth
              ? ii['period_month'] === periodMonth
              : ii['billing_period_id'] === billingPeriodId),
        );
      return {
        rows: [...new Set(billed.map((ii) => ii['enrollment_id']))].map((id) => ({
          enrollment_id: id,
        })),
      };
    }
    if (sql.includes('select distinct m.student_id')) {
      const [, start, end] = params as [string, string, string];
      const students = opts
        .rows('meal_records')
        .filter(
          (m) =>
            (m['meal_date'] as string) >= start &&
            (m['meal_date'] as string) <= end &&
            m['ordered'] &&
            m['chargeable'] &&
            m['invoice_item_id'] === null,
        )
        .map((m) => m['student_id']);
      return { rows: [...new Set(students)].map((id) => ({ student_id: id })) };
    }
    if (sql.includes('select distinct e.student_id')) {
      const [, studentIds, scope] = params as [string, string[], string[]];
      const students = opts
        .rows('enrollments')
        .filter(
          (e) =>
            studentIds.includes(e['student_id'] as string) &&
            scope.includes((e['classes'] as Row | null)?.['campus_id'] as string),
        )
        .map((e) => e['student_id']);
      return { rows: [...new Set(students)].map((id) => ({ student_id: id })) };
    }
    if (sql.includes('select m.invoice_item_id, sum(m.unit_price)')) {
      const [, itemIds] = params as [string, string[]];
      const totals = new Map<string, number>();
      for (const m of opts.rows('meal_records')) {
        const id = m['invoice_item_id'] as string | null;
        if (id && itemIds.includes(id))
          totals.set(id, (totals.get(id) ?? 0) + Number(m['unit_price']));
      }
      return {
        rows: [...totals].map(([id, total]) => ({ invoice_item_id: id, total: String(total) })),
      };
    }
    if (sql.includes('from public.payment_records pr')) {
      // repair 跳過已收款的帳單（#1936）：淨收款 ≠ 0 的帳單底下、在這批 id 裡的明細
      const [, itemIds] = params as [string, string[]];
      const net = new Map<unknown, number>();
      for (const p of opts.rows('payment_records')) {
        const sign = p['kind'] === 'refund' ? -1 : 1;
        net.set(p['invoice_id'], (net.get(p['invoice_id']) ?? 0) + sign * Number(p['amount']));
      }
      return {
        rows: opts
          .rows('invoice_items')
          .filter(
            (ii) => itemIds.includes(ii['id'] as string) && (net.get(ii['invoice_id']) ?? 0) !== 0,
          )
          .map((ii) => ({ id: ii['id'] })),
      };
    }
    if (sql.includes('for update')) return { rows: [] };
    if (sql.includes('insert into public.invoices')) {
      const [orgId, studentId, issuedAt, dueDate, note, userId] = params;
      const id = `fake-invoice-${++seq}`;
      await run(
        opts.client.from('invoices')['insert']!({
          id,
          org_id: orgId,
          student_id: studentId,
          issued_at: issuedAt,
          due_date: dueDate,
          note,
          created_by: userId,
        }),
      );
      return { rows: [{ id }] };
    }
    if (sql.includes("'tuition', t.enrollment_id")) {
      const [invoiceId, enrollmentIds, amounts, billingPeriodId, periodMonth, notes] = params as [
        string,
        string[],
        number[],
        string | null,
        string | null,
        Array<string | null>,
      ];
      await run(
        opts.client.from('invoice_items')['insert']!(
          enrollmentIds.map((enrollmentId, i) => ({
            id: `fake-tuition-${++seq}`,
            invoice_id: invoiceId,
            type: 'tuition',
            enrollment_id: enrollmentId,
            amount: amounts[i],
            billing_period_id: billingPeriodId,
            period_month: periodMonth,
            note: notes[i],
          })),
        ),
      );
      return { rows: [] };
    }
    if (sql.includes("values ($1::uuid, 'meal', 0")) {
      const [invoiceId, periodMonth, note] = params;
      const id = `fake-meal-${++seq}`;
      await run(
        opts.client.from('invoice_items')['insert']!({
          id,
          invoice_id: invoiceId,
          type: 'meal',
          amount: 0,
          period_month: periodMonth,
          note,
        }),
      );
      return { rows: [{ id }] };
    }
    if (sql.includes('with stamped as')) {
      const [itemId, orgId, studentId, start, end] = params as string[];
      const q = opts.client.from('meal_records')['update']!({ invoice_item_id: itemId }) as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      let chain = q;
      for (const [method, args] of [
        ['eq', ['org_id', orgId]],
        ['eq', ['student_id', studentId]],
        ['gte', ['meal_date', start]],
        ['lte', ['meal_date', end]],
        ['eq', ['ordered', true]],
        ['eq', ['chargeable', true]],
        ['is', ['invoice_item_id', null]],
      ] as const) {
        chain = chain[method]!(...args) as typeof chain;
      }
      const stamped = ((await run(chain['select']!('unit_price'))) ?? []) as Row[];
      const total = stamped.reduce((s, r) => s + Number(r['unit_price']), 0);
      await run(
        (
          opts.client.from('invoice_items')['update']!({ amount: total }) as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )['eq']!('id', itemId),
      );
      return { rows: [{ n: stamped.length }] };
    }
    if (sql.includes('delete from public.invoice_items')) {
      await run(
        (
          opts.client.from('invoice_items')['delete']!() as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )['eq']!('id', params[0]),
      );
      return { rows: [] };
    }
    if (sql.includes('select id, name from public.students')) return { rows: [] };
    throw new Error(`fake pool：認不得的語句：${sql.trim().slice(0, 80)}`);
  };

  return {
    query,
    connect: async () => ({ query, release: () => undefined }),
    end: async () => undefined,
    statements,
  };
}
