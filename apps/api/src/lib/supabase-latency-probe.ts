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
 *
 * **時間軸（#1595，2026-10-15 加，找到原因就撤，撤法見 `formatTimeline`）**：拋棄式探針在同一個
 * placement 量到每支 15–30ms，正式站這支卻量到 100–200ms。`[probe-tl]` 每個請求印一行，
 * 用來分辨：6 條連線排隊（同時發、分波回）、Worker 實際不在新加坡（Supabase 回應的
 * `cf-ray` 尾碼）、isolate 冷啟動（`iso#`）、閘道慢（總耗時遠大於 `x-envoy-upstream-service-time`）、
 * 卡在 getSession 後面（`session`）。**只印時間、表名、機房代碼**，不印參數與列資料。
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
  formatTimeline(label: string, sessionDoneAt: number): string | null;
}

/** 這個 isolate 處理過幾個請求 —— 第 1 個就是冷啟動（#1595 時間軸） */
let isolateRequests = 0;

interface TimelineEntry {
  table: string;
  start: number;
  end: number;
  envoy: string;
  colo: string;
}

export function createLatencyProbe(requestStartedAt = Date.now()): LatencyProbe {
  const stats: ProbeStats = { count: 0, totalMs: 0, slowestMs: 0, slowestPath: '' };
  const timeline: TimelineEntry[] = [];
  const iso = ++isolateRequests;

  const probedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const started = Date.now();
    let res: Response | undefined;
    try {
      res = await fetch(input as RequestInfo, init);
      return res;
    } finally {
      const elapsed = Date.now() - started;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      timeline.push({
        // 只取表名：/rest/v1/<table>?… → <table>
        table: /\/rest\/v1\/([\w-]+)/.exec(url)?.[1] ?? 'other',
        start: started - requestStartedAt,
        end: Date.now() - requestStartedAt,
        envoy: res?.headers.get('x-envoy-upstream-service-time') ?? '-',
        // cf-ray 的尾碼是子請求進 Supabase（也在 Cloudflare 後面）的機房 ＝ Worker 實際執行的地方
        colo: res?.headers.get('cf-ray')?.split('-').pop() ?? '-',
      });
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
    /**
     * `[probe-tl] GET /api/x iso#3 session=+120 exec=SIN | +121→+260 user_roles(e2) | …`
     * 時間都是相對 middleware 進入點的毫秒；`e` 是 PostgREST＋DB 自己量的時間。
     *
     * **撤法**：原因找到後開一支 PR，把這個方法、`timeline`、`isolateRequests` 與 middleware 裡
     * 呼叫它的那兩行刪掉（`git revert` 加這支的 PR 即可），連同上面那段檔頭說明。
     */
    formatTimeline(label: string, sessionDoneAt: number) {
      if (timeline.length === 0) return null;
      const exec = [...new Set(timeline.map((t) => t.colo))].join('/');
      const parts = timeline.map((t) => `+${t.start}→+${t.end} ${t.table}(e${t.envoy})`);
      return `[probe-tl] ${label} iso#${iso} session=+${sessionDoneAt - requestStartedAt} exec=${exec} | ${parts.join(' | ')}`;
    },
    format(label: string) {
      if (stats.count === 0) return null;
      return (
        `[probe] ${label} 查詢 ${stats.count} 支、合計 ${stats.totalMs}ms、` +
        `最慢 ${stats.slowestMs}ms（${stats.slowestPath}）`
      );
    },
  };
}
