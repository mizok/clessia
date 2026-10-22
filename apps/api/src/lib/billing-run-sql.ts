import type { Queryable } from './identity-sql';

/**
 * 帳務作業裡「帶一大串 id」或「列數會超過 1000」的讀取，改走 pg（#1934）。
 *
 * **為什麼不能留在 PostgREST**：
 * - `.in(col, ids)` 的 id 放在網址上，幾百個就 414（#1928 量過：200 個 uuid 就可能失敗）
 * - PostgREST 每次最多回 1000 列（`max_rows`），超過的**靜默截斷**
 *
 * 這兩件在帳務上都會動到錢：學費冪等查詢少看到 → 重複開帳；蓋章總額少加 → repair 把金額改低。
 * pg 的陣列參數走 bind，沒有網址長度；查詢也沒有列數上限。
 *
 * **授權範圍不在這裡判斷**：分校範圍（`invoiceInScope` 等）留在 TS（`lib/invoice-campus-scope.ts`）。
 * 這裡只接已經篩好的 id，或跟原本 REST 一字不差的單純條件，並且一律帶 `org_id`（c1）。
 *
 * 失敗一律丟例外（呼叫端轉成 500、不寫入）—— **不回 null 讓呼叫端去猜**。
 */

/** 這些報名在這個週期已經開在「有效帳單」上的那幾筆（作廢單上的不算，#898 裁決 B） */
export async function alreadyBilledViaSql(
  db: Queryable,
  p: {
    readonly orgId: string;
    readonly enrollmentIds: readonly string[];
    readonly periodMonth: string | null;
    readonly billingPeriodId: string | null;
  },
): Promise<Set<string>> {
  if (p.enrollmentIds.length === 0) return new Set();
  const { rows } = await db.query(
    `select distinct ii.enrollment_id
       from public.invoice_items ii
       join public.invoices i on i.id = ii.invoice_id
      where i.org_id = $1::uuid
        and i.voided_at is null
        and ii.type = 'tuition'
        and ii.enrollment_id = any($2::uuid[])
        and (case when $3::date is not null then ii.period_month = $3::date
                  else ii.billing_period_id = $4::uuid end)`,
    [p.orgId, p.enrollmentIds, p.periodMonth, p.billingPeriodId],
  );
  return new Set((rows as Array<{ enrollment_id: string }>).map((r) => r.enrollment_id));
}

/** 這個月份區間有「已訂、要收、還沒開帳」餐記錄的學生（distinct；原本一天一列撈回來會被截在 1000） */
export async function unbilledMealStudentsViaSql(
  db: Queryable,
  p: { readonly orgId: string; readonly start: string; readonly end: string },
): Promise<string[]> {
  const { rows } = await db.query(
    `select distinct m.student_id
       from public.meal_records m
      where m.org_id = $1::uuid
        and m.meal_date between $2::date and $3::date
        and m.ordered and m.chargeable
        and m.invoice_item_id is null`,
    [p.orgId, p.start, p.end],
  );
  return (rows as Array<{ student_id: string }>).map((r) => r.student_id);
}

/**
 * 受限者的餐費學生：**任一報名（不分 status）的班在範圍內**。條件跟原本 REST 那支一樣
 * （`enrollments` + `classes!inner(campus_id)` + `.in(campus_id, scope)`），只是 id 改成陣列參數。
 */
export async function mealStudentsInScopeViaSql(
  db: Queryable,
  p: {
    readonly orgId: string;
    readonly studentIds: readonly string[];
    readonly scope: readonly string[];
  },
): Promise<Set<string>> {
  if (p.studentIds.length === 0 || p.scope.length === 0) return new Set();
  const { rows } = await db.query(
    `select distinct e.student_id
       from public.enrollments e
       join public.classes k on k.id = e.class_id
      where e.org_id = $1::uuid
        and e.student_id = any($2::uuid[])
        and k.campus_id = any($3::uuid[])`,
    [p.orgId, p.studentIds, p.scope],
  );
  return new Set((rows as Array<{ student_id: string }>).map((r) => r.student_id));
}

/**
 * 每筆餐費 item 已蓋章的餐記錄單價總和。**在 SQL 裡加總**：原本把每一列餐記錄撈回來再加，
 * 一個 item 二十幾列，幾十個 item 就超過 1000 列被截斷，總額少算 → repair 把金額改低。
 * 沒有任何蓋章列的 item 不會出現在回傳裡（呼叫端當 0，跟原本一樣）。
 */
export async function stampedTotalsViaSql(
  db: Queryable,
  itemIds: readonly string[],
): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query(
    `select m.invoice_item_id, sum(m.unit_price)::text as total
       from public.meal_records m
      where m.invoice_item_id = any($1::uuid[])
      group by m.invoice_item_id`,
    [itemIds],
  );
  return new Map(
    (rows as Array<{ invoice_item_id: string; total: string }>).map((r) => [
      r.invoice_item_id,
      Number(r.total),
    ]),
  );
}
