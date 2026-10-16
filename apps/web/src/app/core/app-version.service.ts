import { Injectable, signal } from '@angular/core';
import { hasReloadBeenAttempted, isChunkLoadFailure, markReloadAttempted } from './chunk-recovery';

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
