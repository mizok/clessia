/**
 * PostgREST 偶發拒絕 `JWT issued at future`（#1612）時，**讀取**重試一次。
 *
 * 新式的 `sb_secret_…` 金鑰是由 Supabase 閘道每次現場簽一張短期 JWT 給 PostgREST。PostgREST
 * 對 `iat` 已經容許 30 秒的時鐘偏差（docs.postgrest.org 的 auth 參考），所以撞到這個錯誤代表
 * **簽發端的時鐘比 PostgREST 快了超過 30 秒**，是 Supabase 那一側的問題。
 *
 * **這是減輕，不是根治**：等 250ms 不會讓時鐘變對，重試成不成功，要看下一次是不是換到另一台。
 * 根治的選項（換舊式 service_role 金鑰、身分查詢改走 Hyperdrive、向 Supabase 回報）見 #1612。
 *
 * 只重試同時符合這些條件的請求：
 * - `GET`／`HEAD`：PostgREST 文件說 JWT 驗證在切角色與主查詢之前，但**沒保證早於交易開始**，
 *   所以寫入不能證明沒有副作用 → 不重試。
 * - HTTP 401，而且回應的 `code` 是 `PGRST303`、`message` 含 `issued at future`。
 *   其他 401（例如 `PGRST301` 簽章錯誤）是真的錯，重試只會把它藏起來。
 * - **只重試一次**；第二次照原樣回傳，supabase-js 照常把它變成 error → 呼叫端照常回 500。
 */

const RETRY_DELAY_MS = 250;

async function isFutureIat(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown; message?: unknown };
    return (
      body.code === 'PGRST303' &&
      typeof body.message === 'string' &&
      body.message.includes('issued at future')
    );
  } catch {
    return false;
  }
}

export function retryOnFutureIat(inner: typeof fetch): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const first = await inner(input, init);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if ((method !== 'GET' && method !== 'HEAD') || !(await isFutureIat(first))) return first;

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    const second = await inner(input, init);

    // 收證據：偏差有多大、重試有沒有用。**只印錯誤碼、時間戳、method、表名**（#1612 gate）
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const table = /\/rest\/v1\/([\w-]+)/.exec(url)?.[1] ?? 'other';
    const retried = (await isFutureIat(second)) ? 'still-PGRST303' : `status-${second.status}`;
    console.error(
      `[jwt-iat] PGRST303 ${method} ${table} worker=${new Date().toISOString()} ` +
        `supabase=${first.headers.get('date') ?? '-'} retry=${retried}`,
    );
    return second;
  };
  return wrapped as typeof fetch;
}
