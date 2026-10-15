import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryOnFutureIat } from './retry-future-iat';
import { createServiceClientFromEnv } from './supabase';
import type { Bindings } from '../index';

/**
 * #1612：PostgREST 偶發 `JWT issued at future`（PGRST303）。**讀取**重試一次；其他一律不碰。
 * 第二次還失敗就照原樣回 —— 不能變成放行。
 */

const URL_ = 'https://x.supabase.co/rest/v1/user_roles?select=role&user_id=eq.SECRET-USER';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const futureIat = () =>
  json(
    401,
    { code: 'PGRST303', message: 'JWT issued at future', details: null, hint: null },
    {
      date: 'Thu, 15 Oct 2026 08:05:23 GMT',
    },
  );

/** 依序回傳 responses（Response 或要丟的錯誤），並記下呼叫次數 */
function innerReturning(...responses: Array<Response | Error>) {
  const inner = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('沒有更多回應了');
    return next;
  });
  return inner;
}

describe('retryOnFutureIat（#1612）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GET 撞到 PGRST303 issued at future → 重試一次；第二次成功就回成功', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = innerReturning(futureIat(), json(200, [{ role: 'admin' }]));

    const res = await retryOnFutureIat(inner as typeof fetch)(URL_, {
      method: 'GET',
      headers: { Authorization: 'Bearer sb_secret_TOKEN' },
    });

    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
    // 只印錯誤碼、時間戳、method、表名 —— 不能有 token、header 全文、查詢參數
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toMatch(
      /^\[jwt-iat\] PGRST303 GET user_roles worker=\S+ supabase=.+ retry=status-200$/,
    );
    expect(line).not.toMatch(/TOKEN|Bearer|SECRET-USER|select=/);
  });

  it('HEAD 也是讀取，同樣重試', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = innerReturning(futureIat(), json(200, []));
    await retryOnFutureIat(inner as typeof fetch)(URL_, { method: 'HEAD' });
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('第二次還是同一個錯誤 → 原樣回 401，不再重試（只重試一次）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = innerReturning(futureIat(), futureIat(), json(200, []));

    const res = await retryOnFutureIat(inner as typeof fetch)(URL_);

    expect(res.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PGRST301（簽章錯誤）', () => json(401, { code: 'PGRST301', message: 'JWSError' })],
    [
      '訊息一樣但錯誤碼不是 PGRST303',
      () => json(401, { code: 'PGRST301', message: 'JWT issued at future' }),
    ],
    [
      'PGRST303 但不是 issued at future',
      () => json(401, { code: 'PGRST303', message: 'JWT expired' }),
    ],
    ['401 但不是 JSON', () => new Response('Unauthorized', { status: 401 })],
    ['403', () => json(403, { code: '42501', message: 'permission denied' })],
    ['500', () => json(500, { message: 'boom' })],
  ])('其他錯誤不重試：%s', async (_label, make) => {
    const inner = innerReturning(make(), json(200, []));
    const res = await retryOnFutureIat(inner as typeof fetch)(URL_);
    expect(res.status).not.toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('網路錯誤照原樣丟出，不重試', async () => {
    const inner = innerReturning(new TypeError('network'), json(200, []));
    await expect(retryOnFutureIat(inner as typeof fetch)(URL_)).rejects.toThrow('network');
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it.each(['POST', 'PATCH', 'DELETE', 'PUT'])(
    '寫入（%s）撞到同一個錯誤也不重試',
    async (method) => {
      const inner = innerReturning(futureIat(), json(200, []));
      const res = await retryOnFutureIat(inner as typeof fetch)(URL_, { method });
      expect(res.status).toBe(401);
      expect(inner).toHaveBeenCalledTimes(1);
    },
  );

  it('method 寫在 Request 物件上的寫入也不重試', async () => {
    const inner = innerReturning(futureIat(), json(200, []));
    await retryOnFutureIat(inner as typeof fetch)(new Request(URL_, { method: 'POST' }));
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

/** 走真的 supabase-js：兩次都失敗時，查詢結果是 error（呼叫端照常回 500），不是空資料 */
describe('createServiceClientFromEnv 掛上重試（#1612）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' } as Bindings;

  it('第一次 PGRST303、第二次成功 → 拿到資料', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = innerReturning(futureIat(), json(200, [{ role: 'admin' }]));
    vi.stubGlobal('fetch', fetchMock);

    const { data, error } = await createServiceClientFromEnv(env)
      .from('user_roles')
      .select('role')
      .eq('user_id', 'u');

    expect(error).toBeNull();
    expect(data).toEqual([{ role: 'admin' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('兩次都 PGRST303 → error 照樣回來，data 不是空陣列（不會被當成「沒有角色」或放行）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', innerReturning(futureIat(), futureIat()));

    const { data, error } = await createServiceClientFromEnv(env)
      .from('user_roles')
      .select('role')
      .eq('user_id', 'u');

    expect(error?.code).toBe('PGRST303');
    expect(data).toBeNull();
  });
});
