import { ErrorHandler, inject, Injectable, Provider } from '@angular/core';
import { NavigationError } from '@angular/router';

import { AppVersionService } from './app-version.service';
import { isChunkLoadFailure } from './chunk-recovery';

/**
 * 全域 ErrorHandler：接**預載**撞到的舊 chunk。
 *
 * 為什麼預載失敗會走到這裡：`@angular/router` 的 preloader 是
 *   `router.events.pipe(filter(NavigationEnd), concatMap(() => this.preload())).subscribe(() => {})`
 * —— `subscribe` **沒有 error callback**，所以失敗會冒到全域，被
 * `provideBrowserGlobalErrorListeners()` 接住再交給這裡。
 *
 * 同時要知道：那條訂閱掛的是 `concatMap`，**第一次失敗就讓整個預載機制永久死掉**。
 * 所以舊分頁只會丟一次失敗然後靜靜地不再預載 —— 使用者不會察覺，
 * 直到他點進某一頁看到空白。提示條補的就是這個缺口。
 */
@Injectable()
export class ChunkAwareErrorHandler implements ErrorHandler {
  private readonly version = inject(AppVersionService);

  handleError(error: unknown): void {
    if (isChunkLoadFailure(error)) {
      // **原始訊息一定要留。** 真實措辭要等線上撞到第一次才能確認
      // （本機 dev server 沒有 SPA fallback 的 rewrite，重現不出來）——
      // 有了它才能把偵測從「刻意寫寬」收窄。
      console.warn('[chunk] 預載撞到舊版 chunk，顯示更新提示：', error);
      this.version.markStale();
      return;
    }

    // **其餘錯誤照原本的路走。** 少了這一段，這個 handler 會把整個 app 的
    // 錯誤全部吞掉，而那種故障沒有任何測試會變紅。
    console.error(error);
  }
}

/**
 * 導覽失敗時的處理。跟上面那個是**不同的時機**：
 * 這裡使用者按了連結正在等頁面，重載不會沒收任何東西。
 */
export function handleChunkNavigationError(error: NavigationError): void {
  const version = inject(AppVersionService);

  if (!isChunkLoadFailure(error.error)) return;

  console.warn('[chunk] 導覽撞到舊版 chunk，自動重載一次：', error.error);
  version.recoverFromNavigationFailure();
}

export const provideChunkRecovery = (): Provider[] => [
  { provide: ErrorHandler, useClass: ChunkAwareErrorHandler },
];
