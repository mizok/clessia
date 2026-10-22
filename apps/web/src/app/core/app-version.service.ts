import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { hasReloadBeenAttempted, isChunkLoadFailure, markReloadAttempted } from './chunk-recovery';

/** 回到前景時，距離上次比對至少這麼久才再比（同 #1683 角標的節流） */
export const VERSION_CHECK_INTERVAL_MS = 60_000;

/** build 產物的入口檔名（`outputHashing: all` → `main-<內容雜湊>.js`）；dev server 是 `main.js`，比不到 */
const MAIN_SCRIPT = /main-[A-Za-z0-9]+\.js/;

/**
 * 「這個分頁手上的版本已經過期了」這件事的唯一狀態來源。
 *
 * 設計與理由見 `kb/wiki/architecture/chunk-load-recovery.md`。
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  /** 預載撞到舊 chunk —— 顯示提示條，讓使用者自己挑重載的時機 */
  readonly isStale = signal(false);

  /** 重載過還是失敗 —— 不再重載，改成告訴使用者 */
  readonly recoveryFailed = signal(false);

  /** 自己載入的入口檔名；拿不到（dev、測試）就整個不比 */
  private readonly ownMain =
    document.querySelector('script[src*="main-"]')?.getAttribute('src')?.match(MAIN_SCRIPT)?.[0] ??
    null;
  private lastCheck = 0;

  constructor() {
    void this.checkForNewVersion();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.checkForNewVersion();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
  }

  /**
   * 部署後提早知道有新版（#1723）：開站一次、回到前景（節流 60 秒）各抓一次線上的 index.html，
   * 比它引用的入口檔名跟自己載入的。不一樣就亮提示條。
   *
   * **比入口檔名、不比 commit sha**：sha 每次部署都變（只改 API、只改文件也會），會讓所有分頁
   * 亮「有新版本」但前端其實沒變。入口檔名是內容雜湊，而且它引用 lazy chunk 的檔名，
   * 改了任一支 lazy 元件它也跟著變（10-23 實測）。
   *
   * 讀不到、回來的不是有入口檔名的頁面（錯誤頁、維護頁）→ 當作沒比到，**不**亮提示條。
   */
  async checkForNewVersion(): Promise<void> {
    if (!this.ownMain || this.isStale()) return;
    const now = Date.now();
    if (now - this.lastCheck < VERSION_CHECK_INTERVAL_MS) return;
    this.lastCheck = now;
    try {
      // no-store＋query：不讓瀏覽器或中間層回舊的 index.html
      const url = new URL(`./?v=${now}`, document.baseURI);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const live = (await res.text()).match(MAIN_SCRIPT)?.[0];
      if (live && live !== this.ownMain) this.markStale();
    } catch {
      // 離線、斷線：下次回到前景再比
    }
  }

  /**
   * 導覽時撞到舊 chunk。回傳「有沒有真的要重載」讓呼叫端知道。
   *
   * 使用者按了連結、正在等頁面出來 —— 這個時機重載不會沒收任何東西，
   * 而不重載的話他看到的是空白。
   */
  recoverFromNavigationFailure(): boolean {
    if (hasReloadBeenAttempted()) {
      // 已經重載過一次還是失敗（例如 CDN 邊緣仍在發舊的 index.html）。
      // **不再重載** —— 無限轉比空白更糟。
      this.recoveryFailed.set(true);
      return false;
    }

    markReloadAttempted();
    location.reload();
    return true;
  }

  /**
   * 按鈕或元件裡的 `import()` 失敗（#1718）。是舊版 chunk 就亮提示條、回 `true` ——
   * 呼叫端看到 `true` 就**不要**顯示成業務錯誤（「匯出失敗」「無法連線」那種，使用者會一直重試）。
   *
   * **不自動重載**，跟導覽失敗不同：按鈕觸發的當下，畫面上可能有使用者選好的檔案、填好的表單，
   * 重載會沒收它們。讓他自己按提示條的「重新載入」。
   */
  recoverFromImportFailure(error: unknown): boolean {
    if (!isChunkLoadFailure(error)) return false;
    // 原始訊息要留（同 ChunkAwareErrorHandler）：真實措辭要線上撞到才能確認
    console.warn('[chunk] 按鈕裡的 import() 撞到舊版 chunk，顯示更新提示：', error);
    this.markStale();
    return true;
  }

  /** 預載撞到舊 chunk —— 只立旗標不動作 */
  markStale(): void {
    this.isStale.set(true);
  }

  /** 使用者按下提示條的「重新載入」 */
  reloadNow(): void {
    markReloadAttempted();
    location.reload();
  }
}
