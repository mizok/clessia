/**
 * **雙 org 的記憶體 DB 替身**（#966 B 批）—— 給「別 org 的 id 打不到」這一類測試用。
 *
 * 這一族測試要證明的是**條件真的有下**，所以替身**真的照條件過濾**：
 * `eq('org_id', A)` 會真的把 B 的列濾掉，`update` / `delete` 真的改到 / 刪掉符合的列。
 * 回固定資料的替身做不到這件事 —— 條件下對下錯，它回的都一樣。
 *
 * ⚠️ **沒實作的 builder 方法一律丟例外，不放行。** 「替身不認識所以回空」正是過去
 * 測試空轉的來源（1515 charter §三：替身少一個方法，測到的是「請求失敗所以沒稽核」）。
 * 撞到就補實作，不要改成回 `this`。
 *
 * `upsert` 的衝突比對**跨 org**（只看 `onConflict` 那幾欄）—— 跟真的 DB 一樣：衝突鍵不含
 * `org_id` 時，別 org 的同鍵列會被覆寫。那正是 B4 要抓的形狀，替身不能替它擋掉。
 *
 * 刻意不做：`select` 的欄位清單與巢狀關聯（一律回整列）、排序、分頁。
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/** `classes.campus_id` 這種巢狀欄位：沿著種子資料裡的物件往下取（模擬 `classes!inner(...)` 的過濾） */
const field = (row: Row, column: string): unknown =>
  column.split('.').reduce<unknown>((value, key) => (value as Row | null)?.[key], row);

interface Result {
  readonly data: unknown;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly count?: number | null;
}

export interface MultiOrgDb {
  /** 傳給路由當 `supabase` */
  readonly client: unknown;
  /** 目前那張表的內容（測試用來斷言「列沒變」） */
  rows(table: string): readonly Row[];
}

export function createMultiOrgDb(seed: Record<string, readonly Row[]>): MultiOrgDb {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
  );
  const tableOf = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name) as Row[];
  };

  function builder(table: string) {
    let op: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select';
    let conflictKeys: string[] = [];
    let ignoreDuplicates = false;
    let payload: Row | Row[] | null = null;
    let returning = false;
    let countOnly = false;
    const filters: Filter[] = [];
    let rowLimit = Infinity;
    let rowOffset = 0;
    let sortBy: { column: string; ascending: boolean } | null = null;

    function run(): Result {
      const all = tableOf(table);
      const matched = all.filter((row) => filters.every((f) => f(row)));

      if (op === 'insert') {
        const inserted = (Array.isArray(payload) ? payload : [payload as Row]).map((row) => ({
          id: crypto.randomUUID(),
          ...row,
        }));
        all.push(...inserted);
        return { data: returning ? inserted : null, error: null };
      }
      if (op === 'upsert') {
        const written: Row[] = [];
        for (const incoming of Array.isArray(payload) ? payload : [payload as Row]) {
          const existing = all.find((row) => conflictKeys.every((k) => row[k] === incoming[k]));
          if (existing && ignoreDuplicates) continue;
          if (existing) Object.assign(existing, incoming);
          else all.push({ id: crypto.randomUUID(), ...incoming });
          written.push({ ...(existing ?? all[all.length - 1]) });
        }
        return { data: returning ? written : null, error: null };
      }
      if (op === 'update') {
        for (const row of matched) Object.assign(row, payload);
        return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === 'delete') {
        tables.set(
          table,
          all.filter((row) => !matched.includes(row)),
        );
        return { data: returning ? matched : null, error: null };
      }
      if (countOnly) return { data: null, count: matched.length, error: null };
      if (sortBy) {
        const { column, ascending } = sortBy;
        matched.sort((x, y) => {
          const a = String(field(x, column) ?? '');
          const b = String(field(y, column) ?? '');
          return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      return {
        data: matched.slice(rowOffset, rowOffset + rowLimit).map((r) => ({ ...r })),
        count: matched.length,
        error: null,
      };
    }

    function one(required: boolean): Result {
      const result = run();
      const list = (result.data ?? []) as Row[];
      if (list.length > 1)
        return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
      if (list.length === 0 && required) {
        return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      return { data: list[0] ?? null, error: null };
    }

    const impl: Record<string, unknown> = {
      gte(column: string, value: string) {
        filters.push((row) => field(row, column) != null && String(field(row, column)) >= value);
        return proxy;
      },
      lte(column: string, value: string) {
        filters.push((row) => field(row, column) != null && String(field(row, column)) <= value);
        return proxy;
      },
      gt(column: string, value: string) {
        filters.push((row) => field(row, column) != null && String(field(row, column)) > value);
        return proxy;
      },
      /** PostgREST 的 `.range(from, to)`（含頭尾） */
      range(from: number, to: number) {
        rowOffset = from;
        rowLimit = to - from + 1;
        return proxy;
      },
      order(column: string, options?: { ascending?: boolean }) {
        sortBy = { column, ascending: options?.ascending !== false };
        return proxy;
      },
      select(_columns?: string, options?: { count?: string; head?: boolean }) {
        if (op === 'select') countOnly = options?.head === true;
        else returning = true;
        return proxy;
      },
      insert(value: Row | Row[]) {
        op = 'insert';
        payload = value;
        return proxy;
      },
      upsert(value: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        op = 'upsert';
        payload = value;
        conflictKeys = (options?.onConflict ?? 'id').split(',').map((k) => k.trim());
        ignoreDuplicates = options?.ignoreDuplicates === true;
        return proxy;
      },
      update(value: Row) {
        op = 'update';
        payload = value;
        return proxy;
      },
      delete() {
        op = 'delete';
        return proxy;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => field(row, column) === value);
        return proxy;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return proxy;
      },
      in(column: string, values: readonly unknown[]) {
        filters.push((row) => values.includes(field(row, column)));
        return proxy;
      },
      limit(count: number) {
        rowLimit = count;
        return proxy;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator !== 'is') throw new Error(`multi-org-db：not(…, '${operator}') 沒有實作`);
        filters.push((row) => (row[column] ?? null) !== value);
        return proxy;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (field(row, column) ?? null) === value);
        return proxy;
      },
      single: () => Promise.resolve(one(true)),
      maybeSingle: () => Promise.resolve(one(false)),
      /** PostgREST 的 `or('a.lt.x,b.eq.y')`：只支援 eq / neq / lt / lte / gt / gte 與 `is.null`，值一律字串比較 */
      or(expression: string) {
        const ops: Record<string, (a: string, b: string) => boolean> = {
          eq: (a, b) => a === b,
          neq: (a, b) => a !== b,
          lt: (a, b) => a < b,
          lte: (a, b) => a <= b,
          gt: (a, b) => a > b,
          gte: (a, b) => a >= b,
        };
        const terms = expression.split(',').map((term) => {
          const [column, op, ...rest] = term.split('.');
          if (op === 'is' && rest.join('.') === 'null') {
            return (row: Row) => (row[column as string] ?? null) === null;
          }
          const compare = ops[op as string];
          if (!column || !compare) throw new Error(`multi-org-db：or 不支援 \`${term}\``);
          return (row: Row) => row[column] != null && compare(String(row[column]), rest.join('.'));
        });
        filters.push((row) => terms.some((test) => test(row)));
        return proxy;
      },
      then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };

    const proxy: unknown = new Proxy(impl, {
      get(target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop in target) return target[prop];
        throw new Error(
          `multi-org-db：builder 沒有實作 \`${prop}\`（${table}）—— 補實作，不要放行`,
        );
      },
    });
    return proxy;
  }

  const client = new Proxy(
    { from: (table: string) => builder(table) },
    {
      get(target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop in target) return target[prop as 'from'];
        throw new Error(`multi-org-db：client 沒有實作 \`${prop}\` —— 補實作，不要放行`);
      },
    },
  );

  return { client, rows: (table) => tableOf(table).map((row) => ({ ...row })) };
}

/**
 * 模擬 PostgREST 的 `max_rows`（`supabase/config.toml` 是 1000）：撈列的查詢**靜默**只回前 1000 列，
 * head count 不受影響。實作若改回「撈列回來在記憶體數」，超過一千筆時數字會偷偷變少。
 */
export function withMaxRows(client: any, maxRows: number): any {
  const wrap = (b: any): any =>
    new Proxy(b, {
      get(target, prop) {
        if (prop === 'then')
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            target.then(
              (r: any) =>
                resolve(Array.isArray(r?.data) ? { ...r, data: r.data.slice(0, maxRows) } : r),
              reject,
            );
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? (...args: unknown[]) => wrap(v.apply(target, args)) : v;
      },
    });
  return new Proxy(client, {
    get(target, prop) {
      if (prop !== 'from') return Reflect.get(target, prop);
      return (table: string) => wrap(target.from(table));
    },
  });
}
