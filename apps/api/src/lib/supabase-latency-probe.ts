/**
 * ⚠️ **臨時量測，跑一天就拿掉。** 立案於 2026-09-03。
 *
 * 要回答的問題：**Worker 到 Supabase REST 的單次呼叫實際花多久，以及一次請求
 * 打了幾支。** 那是「業務路由要不要改走 pg 經 Hyperdrive」唯一能結束猜測的數字，
 * 而它從外部量不到（見延遲拆段報告）。
 *
 * 已知：查詢執行 ≈ 1ms、台灣→新加坡建立一條 HTTPS ≈ 60–85ms。
 * 未知：Worker 那一端的實際分布，以及 Workers 有沒有重用到 Supabase 的連線。
 *
 * **不改變任何行為** —— 只在 supabase-js 的 fetch 外面包一層計時。跟 #163 同一類：
 * 先看得見，再談要不要修。
 *
 * 包 `fetch` 而不是包 `.from()`：**fetch 的時間就是我們要的那個數字**
 * （TLS + 往返 + PostgREST 處理）；`.from()` 是可鏈式 builder，包它會混進呼叫端
 * 自己的程式時間。
 *
 * **由呼叫端決定什麼時候印**（middleware 在 `await next()` 之後），不是自己猜
 * 「平行查詢都跑完了沒」—— 猜的版本會在第一支結束時就印出 `count: 1`。
 * 這跟 `lib/get-auth.ts` 的池收尾同一個形狀：收尾要等 response 成形。
 */
export interface ProbeStats {
  /** 這個請求打了幾支 —— 「延遲 = 固定成本 × 次數」裡的次數 */
  count: number;
  totalMs: number;
  slowestMs: number;
  slowestPath: string;
}

export interface LatencyProbe {
  fetch: typeof fetch;
  stats: ProbeStats;
  /** 沒有任何查詢時回 null —— 印一行「0 支」只是雜訊 */
  format(label: string): string | null;
}

export function createLatencyProbe(): LatencyProbe {
  const stats: ProbeStats = { count: 0, totalMs: 0, slowestMs: 0, slowestPath: '' };

  const probedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const started = Date.now();
    try {
      return await fetch(input as RequestInfo, init);
    } finally {
      const elapsed = Date.now() - started;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // 只留路徑 —— 要知道的是「哪一支慢」，不是完整 URL
      const path = url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80);

      stats.count += 1;
      stats.totalMs += elapsed;
      if (elapsed >= stats.slowestMs) {
        stats.slowestMs = elapsed;
        stats.slowestPath = path;
      }
    }
  };

  return {
    fetch: probedFetch as typeof fetch,
    stats,
    format(label: string) {
      if (stats.count === 0) return null;
      return (
        `[probe] ${label} 查詢 ${stats.count} 支、合計 ${stats.totalMs}ms、` +
        `最慢 ${stats.slowestMs}ms（${stats.slowestPath}）`
      );
    },
  };
}
