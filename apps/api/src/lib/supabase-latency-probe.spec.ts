import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLatencyProbe } from './supabase-latency-probe';

/**
 * #1595 時間軸是印進正式站 log 的東西 —— **只能有時間、表名、機房代碼**。
 * 查詢參數（user_id、學生 id、搜尋字）一個字都不能出現。
 */
describe('createLatencyProbe 的時間軸（#1595，臨時）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('印表名、相對時間、envoy 與執行機房；不印任何查詢參數', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('[]', {
          headers: { 'x-envoy-upstream-service-time': '3', 'cf-ray': 'a4acf9c20a1ecf1a-SIN' },
        }),
      ),
    );
    const started = Date.now();
    const probe = createLatencyProbe(started);
    await probe.fetch(
      'https://x.supabase.co/rest/v1/staff?select=status,display_name&user_id=eq.SECRET-USER&name=ilike.*王*',
    );

    const line = probe.formatTimeline('GET /api/me', started + 5)!;
    expect(line).toMatch(/^\[probe-tl\] GET \/api\/me iso#\d+ session=\+5 exec=SIN \| \+\d+→\+\d+ staff\(e3\)$/);
    expect(line).not.toMatch(/SECRET|display_name|ilike|王|select/);
  });

  it('沒有查詢就不印', () => {
    expect(createLatencyProbe().formatTimeline('GET /api/x', Date.now())).toBeNull();
  });
});
