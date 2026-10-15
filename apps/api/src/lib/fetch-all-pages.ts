/**
 * 撈到底：每頁 1000（= PostgREST `max_rows`）、翻到不足一頁為止 —— 一次撈會被 `max_rows`
 * 靜默截斷。`page` 每次要回一支**新的** builder（照穩定排序切 range）。任一頁失敗就回 error，
 * 不回半套。
 *
 * ponytail: O(全部列) 每次呼叫 —— 量大時升級成 DB 側 view／RPC（migration）。
 */
export const PAGE = 1000;

export async function fetchAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<{ rows: Array<Record<string, unknown>>; error: unknown }> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if ((data ?? []).length < PAGE) return { rows, error: null };
  }
}
