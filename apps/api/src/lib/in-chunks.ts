/**
 * PostgREST 的 `.in(col, ids)` 整串放在 URL 上，~200 個 uuid 就 414（#1928 實測：~100 能過）。
 *
 * **只給「使用者勾的 id」用**（課堂批次，#2232）：範圍清單請照 #1928 的裁定改成 embed `!inner`，
 * 不要撈出 id 再分段塞回來。分段**依序**送（不平行）：Workers 每請求的 subrequest 有上限，
 * 一次放出十段會跟其他查詢搶連線。第一段出錯就停，回到目前為止的資料與那個錯。
 *
 * 不是交易：跟原本單支 REST 一樣，中途失敗時前面幾段已經寫進去了 —— 呼叫端原本怎麼處理
 * 部分失敗（回錯、補償）就照舊。
 */
export const IN_CHUNK_SIZE = 100;

export interface ChunkResult<T, E> {
  data: T[];
  error: E | null;
}

export async function inChunks<T = unknown, E extends { message: string } = { message: string }>(
  ids: readonly string[],
  run: (part: string[]) => PromiseLike<{ data?: T[] | null; error: E | null }>,
): Promise<ChunkResult<T, E>> {
  const data: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const { data: part, error } = await run(ids.slice(i, i + IN_CHUNK_SIZE));
    if (error) return { data, error };
    if (part) data.push(...part);
  }
  return { data, error: null };
}
