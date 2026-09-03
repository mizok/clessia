import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLatencyProbe } from './supabase-latency-probe';

describe('createLatencyProbe', () => {
  // `restoreAllMocks` **不會**還原 stubGlobal —— 用錯的話 fetch 會漏到別的測試去
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(delays: Record<string, number> = {}) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      const delay = Object.entries(delays).find(([key]) => url.includes(key))?.[1] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return new Response('{}');
    });
  }

  it('數出打了幾支，並指出最慢的那一支', async () => {
    stubFetch({ slow: 20 });
    const probe = createLatencyProbe();

    await Promise.all([
      probe.fetch('https://example.supabase.co/rest/v1/fast?select=id'),
      probe.fetch('https://example.supabase.co/rest/v1/slow?select=id'),
    ]);

    // 「延遲 = 固定成本 × 次數」—— 次數是這支探針的主要產出
    expect(probe.stats.count).toBe(2);
    expect(probe.stats.slowestPath).toContain('/rest/v1/slow');
    expect(probe.format('GET /api/x')).toContain('查詢 2 支');
  });

  it('只留路徑，不把主機名印進 log', async () => {
    stubFetch();
    const probe = createLatencyProbe();

    await probe.fetch('https://example.supabase.co/rest/v1/students?select=id');

    expect(probe.stats.slowestPath).toBe('/rest/v1/students?select=id');
  });

  it('fetch 丟例外時照樣算進統計 —— 失敗的請求也花了時間', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('boom');
    });
    const probe = createLatencyProbe();

    await expect(probe.fetch('https://example.supabase.co/rest/v1/x')).rejects.toThrow('boom');

    expect(probe.stats.count).toBe(1);
  });

  it('一支查詢都沒有就不印 —— 印「0 支」只是雜訊', () => {
    expect(createLatencyProbe().format('GET /api/system-time')).toBeNull();
  });
});
