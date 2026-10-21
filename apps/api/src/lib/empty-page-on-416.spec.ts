import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { emptyPageOnRangeNotSatisfiable } from './empty-page-on-416';

/** 本機真 PostgREST 對 `offset=99990`（共 69 列）回的就是這個（#1455 實測） */
const pgrst103 = () =>
  new Response(
    JSON.stringify({
      code: 'PGRST103',
      details: 'An offset of 99990 was requested, but there are only 69 rows.',
      hint: null,
      message: 'Requested range not satisfiable',
    }),
    {
      status: 416,
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-range': '*/69' },
    },
  );

const clientWith = (inner: typeof fetch) =>
  createClient('http://localhost:54321', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: emptyPageOnRangeNotSatisfiable(inner) },
  });

describe('emptyPageOnRangeNotSatisfiable（#1455）', () => {
  it('頁數超出結果（416 PGRST103）：supabase-js 拿到空頁、沒有 error，total 照實', async () => {
    const supabase = clientWith(vi.fn(async () => pgrst103()) as unknown as typeof fetch);
    const { data, error, count } = await supabase
      .from('students')
      .select('id', { count: 'exact' })
      .range(99990, 100009);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(count).toBe(69);
  });

  it('沒有包的話就是 error（證明上一支測到的是這層）', async () => {
    const supabase = createClient('http://localhost:54321', 'test-key', {
      auth: { persistSession: false },
      global: { fetch: (async () => pgrst103()) as unknown as typeof fetch },
    });
    const { error } = await supabase
      .from('students')
      .select('id', { count: 'exact' })
      .range(99990, 100009);
    expect(error?.code).toBe('PGRST103');
  });

  it('其他 416、寫入的 416、別的錯誤照原樣', async () => {
    const other416 = new Response(JSON.stringify({ code: 'PGRST999' }), { status: 416 });
    const wrapped = emptyPageOnRangeNotSatisfiable(
      vi.fn(async () => other416) as unknown as typeof fetch,
    );
    expect((await wrapped('http://x/rest/v1/t')).status).toBe(416);

    const onPost = emptyPageOnRangeNotSatisfiable(
      vi.fn(async () => pgrst103()) as unknown as typeof fetch,
    );
    expect((await onPost('http://x/rest/v1/t', { method: 'POST' })).status).toBe(416);

    const err500 = new Response('{}', { status: 500 });
    const passthrough = emptyPageOnRangeNotSatisfiable(
      vi.fn(async () => err500) as unknown as typeof fetch,
    );
    expect(await passthrough('http://x/rest/v1/t')).toBe(err500);
  });
});

describe('createServiceClientFromEnv 有接上這層（#1455）', () => {
  it('每個請求用的 client：頁數超出 → 空頁＋total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => pgrst103()),
    );
    try {
      const { createServiceClientFromEnv } = await import('./supabase');
      const supabase = createServiceClientFromEnv({
        SUPABASE_URL: 'http://localhost:54321',
        SUPABASE_SECRET_KEY: 'test-key',
      } as never);
      const { data, error, count } = await supabase
        .from('students')
        .select('id', { count: 'exact' })
        .range(99990, 100009);
      expect({ data, error, count }).toEqual({ data: [], error: null, count: 69 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
