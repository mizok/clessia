/**
 * 伺服器分頁的頁數超出結果時，當成空頁（#1455）。
 *
 * `.range(offset, …)` 配 `{ count: 'exact' }`、offset ≥ 總筆數時，PostgREST 回
 * **416 `PGRST103` Requested range not satisfiable**，supabase-js 把它變成 error，路由就回 500／400。
 * 使用者撞到的形狀：停在第 3 頁時改篩選，新結果不足 3 頁 → 整頁錯誤。
 *
 * **修在 client 的 fetch 這一層，不在每支路由**：全站用 `.range` 加 count 的列表有十幾支，
 * 每支各補一次，下一支新的就會忘。這裡把 416 PGRST103 改寫成 `200 []`，**保留 `Content-Range` 標頭**
 * （PostgREST 在那裡放了總筆數）—— supabase-js 的 count 就是從這個 header 讀的，所以 `total` 照實回，`data` 是空陣列。
 *
 * 只改寫同時符合的回應：`GET`／`HEAD`、HTTP 416、body 的 `code` 是 `PGRST103`。其他 416 照原樣。
 */
async function isRangeNotSatisfiable(res: Response): Promise<boolean> {
  if (res.status !== 416) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return body.code === 'PGRST103';
  } catch {
    return false;
  }
}

export function emptyPageOnRangeNotSatisfiable(inner: typeof fetch): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await inner(input, init);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if ((method !== 'GET' && method !== 'HEAD') || !(await isRangeNotSatisfiable(res))) return res;

    const headers = new Headers(res.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(method === 'HEAD' ? null : '[]', { status: 200, headers });
  };
  return wrapped as typeof fetch;
}
