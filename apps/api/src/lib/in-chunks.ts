/**
 * PostgREST 的 `.in(col, ids)`／`.or(…)` 整串放在 URL 上，~200 個 uuid 就 414（#1928 實測：~100 能過）。
 *
 * **只給「使用者送來的清單」用**（課堂批次勾到的 id、匯入檔裡的姓名，#2232）：範圍清單請照 #1928 的裁定
 * 改成 embed `!inner`，不要撈出 id 再分段塞回來。分段**依序**送（不平行）：Workers 每請求的 subrequest
 * 有上限，一次放出十段會跟其他查詢搶連線。第一段出錯就停，回到目前為止的資料與那個錯。
 *
 * **只用在查詢**。分段寫入不是原子的（前幾段寫了、後面失敗），要原子就走池（`lib/session-batch-write.ts`）。
 */
export const IN_CHUNK_SIZE = 100;
/**
 * 一段清單在 URL 上最多佔多少 bytes（照 `encodeURIComponent` 算）。#1928 的 414 大約在 7KB 上下，
 * 留一半給同一個 URL 上的 select 與其他條件
 */
export const IN_URL_BUDGET = 3500;

export interface ChunkResult<T, E> {
  data: T[];
  error: E | null;
}

/**
 * 長短不一的字串（中文姓名、校名：最長 100 字，編碼後一字 9 bytes）照編碼後的長度分段；
 * 每個值另算 8 bytes 給引號、逗號、`name.ilike.` 這類包裝。單一個值超過預算就自己一段
 */
export function chunkByUrlLength(values: readonly string[], budget = IN_URL_BUDGET): string[][] {
  const parts: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const value of values) {
    const cost = encodeURIComponent(value).length + 8;
    if (current.length > 0 && used + cost > budget) {
      parts.push(current);
      current = [];
      used = 0;
    }
    current.push(value);
    used += cost;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * `parts` 不給就每 {@link IN_CHUNK_SIZE} 個一段（uuid 長度固定）；字串清單請傳 {@link chunkByUrlLength} 的結果
 */
export async function inChunks<T = unknown, E extends { message: string } = { message: string }>(
  ids: readonly string[],
  run: (part: string[]) => PromiseLike<{ data?: T[] | null; error: E | null }>,
  parts?: readonly string[][],
): Promise<ChunkResult<T, E>> {
  const data: T[] = [];
  const chunks: readonly string[][] =
    parts ??
    Array.from({ length: Math.ceil(ids.length / IN_CHUNK_SIZE) }, (_, k) =>
      ids.slice(k * IN_CHUNK_SIZE, (k + 1) * IN_CHUNK_SIZE),
    );
  for (const part of chunks) {
    const { data: rows, error } = await run(part);
    if (error) return { data, error };
    if (rows) data.push(...rows);
  }
  return { data, error: null };
}
