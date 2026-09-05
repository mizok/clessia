/**
 * 線上 smoke 探測的**判斷邏輯**。純函式，不碰網路 —— 網路那半在 `../smoke.mjs`。
 *
 * ## 設計的核心：期望值從部署產物推導，不維護清單
 *
 * 「探測要斷言什麼」最容易腐化的做法是維護一份字串清單（頁面上該有「登入」兩個字…）。
 * **使用者可見的文案改得很勤，而一個因為文案被合理修改而變紅的探測，第三次就會被關掉**
 * —— 被關掉的那天，沒有人會記得它原本也在守別的東西。
 *
 * 所以這裡只斷言**結構上非有不可**的東西，而最好的一支完全不需要維護：
 * **從剛部署的 `index.html` 讀出 `<script src>`，再去 fetch 它。**
 * 今天叫 `main-A1B2.js`、明天叫別的，探測不用改 —— 期望值來自部署本身。
 * 它抓的是 Pages 真實的失敗模式：**index.html 上了但 chunk 沒上。**
 *
 * ## 一個必須寫在這裡的陷阱
 *
 * **不要探 `/health`。** 它掛在 `/health` 而不是 `/api/health`，而正式站的
 * Cloudflare 路由**只有 `/api/*` 進 Worker**，其餘走 Pages。所以線上 `GET /health`
 * 會由 Pages 回 SPA 的 index.html、**HTTP 200 —— 就算 Worker 整個死掉也一樣**。
 *
 * **一個永遠綠的探測比沒有探測更糟**：它讓人以為 API 有人看著。
 * 唯一真的驗得到 Worker 活著的公開端點是 `/api/system-time`
 * （在 `/api/*` 底下，且註冊在 `app.use('/api/*', authMiddleware)` 之前）。
 *
 * ## 每支探測都要寫「它會抓到什麼壞掉」
 *
 * 寫不出來的就刪掉 —— 那表示沒有人知道它在守什麼，而那種探測遲早會因為
 * 某次無關的改動變紅，然後被註解掉。
 */

/**
 * 從 HTML 取出 `<script src>` 的絕對網址。
 *
 * 只取有 `src` 的（inline script 沒有東西可 fetch），並解析成絕對網址 ——
 * Angular 產出的是根相對路徑（`/main-XXXX.js`）。
 *
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]} 去重後的絕對網址
 */
export function extractScriptUrls(html, baseUrl) {
  const urls = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      urls.add(new URL(m[1], baseUrl).toString());
    } catch {
      // **這個 catch 幾乎不會觸發**：`new URL` 對看不懂的東西不丟例外，
      // 它會把那串字當成相對路徑解掉（`"ht tp://x"` → `<base>/ht%20tp://x`）。
      // 留著只是防真正的邊界情況（空字串之類）。
      //
      // **刻意不做 src 的合法性驗證**：Angular 的建置產物不會有壞掉的 src，
      // 而多驗一層是在拿「探測自己誤判」去換一個不存在的問題 ——
      // 壞 src 真的出現的話，它會在 fetch 那一步變成 404 而被抓到，訊息也看得懂。
    }
  }
  return [...urls];
}

/**
 * 把一批探測結果收斂成一個結論。
 *
 * **成功靜默**（計畫席 2026-09-05 裁）：排程每 N 分鐘跑一次，成功也叫的話
 * 訊號會被自己的噪音淹掉。只有失敗才輸出。
 *
 * @param {Array<{name: string, ok: boolean, detail: string}>} results
 */
export function summarize(results) {
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    failed,
    // 開 issue 用的標題要**穩定**：每次跑都不一樣的話會開出一堆重複 issue，
    // 而去重靠的是「同標籤下有沒有 open 的」，不是標題比對 —— 但人讀 issue 列表時
    // 標題仍然要看得出壞了幾支。
    title: `線上 smoke 探測失敗（${failed.length}/${results.length}）`,
    body: results.map((r) => `- ${r.ok ? '✅' : '❌'} **${r.name}** —— ${r.detail}`).join('\n'),
  };
}
