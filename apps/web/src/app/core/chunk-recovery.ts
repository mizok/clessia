/**
 * 部署後舊分頁要不到新 chunk 的復原。
 *
 * 設計與理由見 `kb/wiki/architecture/chunk-load-recovery.md`。兩件事在讀這支檔案
 * 之前要先知道，否則會覺得下面的判斷式寫得太寬：
 *
 * 1. **沒有 `ChunkLoadError`** —— 那是 webpack 的產物。本專案是
 *    `@angular/build:application`（esbuild）+ 原生 `import()`，
 *    失敗時丟的是**瀏覽器措辭的 `TypeError`**，各家都不一樣。
 * 2. **不會有 404** —— `public/_redirects` 的 `/* /index.html 200` 會把要不到的
 *    chunk 重寫成 index.html（200 + `text/html`），於是錯誤可能是 MIME 型別問題
 *    而不是網路失敗。
 */

/** 防迴圈旗標。用 `sessionStorage` —— 跟著分頁走，關掉就重置。 */
export const RELOAD_FLAG = 'clessia:chunk-reloaded';

/**
 * 旗標的有效期。
 *
 * **用時間窗而不是「成功導覽就清掉」。** 後者看起來更精確，實際上有迴圈：
 * 重載之後第一頁（不需要新 chunk）會成功 → 旗標被清掉 → 使用者點下一頁又失敗
 * → 又重載。時間窗一個機制就把兩種情況都蓋掉：
 *
 * - 重載後**短時間內**再失敗（CDN 邊緣還在發舊的 index.html）→ 擋住，顯示錯誤
 * - **一分鐘後**的另一次部署 → 旗標過期，可以再自動救一次
 *
 * 60 秒的取捨：夠長，讓重載跑完；夠短，讓同一個 session 裡的後續部署仍能自動復原。
 * 偏向「擋住」是刻意的 —— 使用者卡在重載迴圈裡，比看到一句「請手動重新整理」糟得多。
 */
export const RELOAD_WINDOW_MS = 60_000;

/**
 * 各瀏覽器對「動態 import 掛了」的措辭，加上 SPA fallback 造成的 MIME 型別錯誤。
 *
 * **刻意寫寬。** 真實措辭要等線上撞到第一次才能確認（本機 dev server 沒有那個
 * rewrite，重現不出來）。多攔的代價是一次不必要的重載，少攔的代價是使用者看到空白 ——
 * 兩者不對等。
 */
const FAILURE_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  // webpack 時代的名字。現在的 builder 不會產生它，但留著 ——
  // 將來若換回 webpack，這裡不會靜靜失效。
  /loading chunk \d+ failed/i,
];

/**
 * 這個錯誤是不是「chunk 要不到」。
 *
 * **反例跟正例一樣重要**：一個什麼都說 true 的偵測會讓每個錯誤都觸發重載，
 * 那比原本的空白畫面更糟 —— 使用者會掉進重載迴圈。所以只認 `Error` 實例，
 * 不認長得像的字串。
 */
export function isChunkLoadFailure(error: unknown): boolean {
  if (!error) return false;

  // 全域監聽器會把 rejection 包一層再交給 ErrorHandler
  if (typeof error === 'object' && 'rejection' in error) {
    return isChunkLoadFailure((error as { rejection: unknown }).rejection);
  }

  if (!(error instanceof Error)) return false;

  if (error.name === 'ChunkLoadError') return true;

  const message = error.message ?? '';
  return FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * 已經重載過了嗎。
 *
 * **讀不到旗標時回 `true`**（當成已經試過）—— 無痕模式或阻擋 cookie 的瀏覽器
 * 存不了旗標，那種情況下「再試一次」會變成無限迴圈。寧可讓使用者看到錯誤訊息
 * 自己按重整，也不要把他鎖在重載迴圈裡。
 */
export function hasReloadBeenAttempted(now = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_FLAG);
    if (raw === null) return false;

    const at = Number(raw);
    // 值壞掉（有人手動改過、或舊格式）→ 當成剛試過。
    // 解析不出來就往「不要重載」的方向倒。
    if (!Number.isFinite(at)) return true;

    return now - at < RELOAD_WINDOW_MS;
  } catch {
    return true;
  }
}

export function markReloadAttempted(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // 存不了就算了 —— `hasReloadBeenAttempted()` 那邊會擋住第二次
  }
}
