import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

/**
 * 某個瞬間在**台北**是哪一個日曆日（`YYYY-MM-DD`）。
 *
 * **一個「瞬間」不等於一個「日期」——中間差一個時區，而那個時區必須是明著選的。**
 * 這支存在的理由是 web 端原本兩條路都是錯的：`format(new Date(), 'yyyy-MM-dd')`
 * 用**瀏覽器本地**時區，`toISOString().slice(0, 10)` 用 **UTC**。伺服器判斷
 * 「今天」用的是 `Asia/Taipei`（`apps/api/src/lib/taipei-date.ts`），所以前端
 * 只要挑了別的時區，同一筆資料就會在兩側得到不同的答案。
 *
 * 刻意跟後端那支長得一樣（`Intl` + `formatToParts`），因為它們回答的是同一個
 * 問題。**但不要把後端那支搬進 `packages/`** —— 那會讓前端相依後端 lib；
 * 兩邊各自持有一份十行的純函式比一條跨層相依便宜。
 */
export function taipeiDateString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

@Injectable({
  providedIn: 'root',
})
export class SystemClockService {
  private readonly apiService = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly tickIntervalMs = 1000;
  private readonly resyncIntervalMs = 5 * 60 * 1000;

  private readonly ticker = signal(0);
  private readonly baseServerEpochMs = signal<number | null>(null);
  private readonly basePerformanceMs = signal(0);
  private readonly syncedAtEpochMs = signal<number | null>(null);
  private readonly syncError = signal<string | null>(null);

  readonly synced = computed(() => this.baseServerEpochMs() !== null);
  readonly nowEpochMs = computed(() => {
    this.ticker();
    const baseEpochMs = this.baseServerEpochMs();
    if (baseEpochMs === null) {
      return Date.now();
    }

    const elapsedMs = Math.max(performance.now() - this.basePerformanceMs(), 0);
    return Math.floor(baseEpochMs + elapsedMs);
  });
  readonly nowDate = computed(() => new Date(this.nowEpochMs()));
  readonly nowIso = computed(() => this.nowDate().toISOString());
  /**
   * 台北時區的「今天」（`YYYY-MM-DD`），基準是**跟伺服器對過的瞬間**而不是
   * `new Date()`，所以使用者的機器時鐘走掉了也還是對的。
   *
   * **是 signal 不是常數**，這一點跟它的時區一樣重要：欄位初始化取一次快照的話，
   * 一個開著沒關的頁面跨過午夜之後，整晚都在拿昨天的日期判斷逾期。
   * 它跟著 `ticker` 每秒重算，但 signal 以值去重 —— 下游一天只會被叫醒一次。
   */
  readonly todayTaipei = computed(() => taipeiDateString(this.nowEpochMs()));
  readonly lastSyncedAt = computed(() => {
    const syncedAt = this.syncedAtEpochMs();
    return syncedAt === null ? null : new Date(syncedAt);
  });
  readonly lastError = this.syncError.asReadonly();

  private tickTimerId: ReturnType<typeof setInterval> | null = null;
  private resyncTimerId: ReturnType<typeof setInterval> | null = null;
  private inFlightSync: Promise<void> | null = null;
  private removeOnlineListener?: () => void;
  private removeVisibilityListener?: () => void;

  constructor() {
    this.startTicking();
    this.startAutoResync();
    this.setupBrowserEventResync();
    this.destroyRef.onDestroy(() => {
      if (this.tickTimerId !== null) {
        clearInterval(this.tickTimerId);
      }
      if (this.resyncTimerId !== null) {
        clearInterval(this.resyncTimerId);
      }

      this.removeOnlineListener?.();
      this.removeVisibilityListener?.();
    });
  }

  async initialize(): Promise<void> {
    await this.syncWithServer();
  }

  async syncWithServer(): Promise<void> {
    if (this.inFlightSync) {
      return this.inFlightSync;
    }

    this.inFlightSync = firstValueFrom(this.apiService.getSystemTime())
      .then((response) => {
        this.baseServerEpochMs.set(response.epochMs);
        this.basePerformanceMs.set(performance.now());
        this.syncedAtEpochMs.set(Date.now());
        this.syncError.set(null);
      })
      .catch((error: unknown) => {
        console.error('[SystemClockService] syncWithServer failed', error);
        this.syncError.set('SYNC_FAILED');
      })
      .finally(() => {
        this.inFlightSync = null;
      });

    return this.inFlightSync;
  }

  private startTicking(): void {
    this.tickTimerId = setInterval(() => {
      this.ticker.update((value) => value + 1);
    }, this.tickIntervalMs);
  }

  private startAutoResync(): void {
    this.resyncTimerId = setInterval(() => {
      void this.syncWithServer();
    }, this.resyncIntervalMs);
  }

  private setupBrowserEventResync(): void {
    const runtimeWindow = globalThis.window;
    const runtimeDocument = globalThis.document;
    if (!runtimeWindow || !runtimeDocument) {
      return;
    }

    const onOnline = (): void => {
      void this.syncWithServer();
    };
    runtimeWindow.addEventListener('online', onOnline);
    this.removeOnlineListener = () => runtimeWindow.removeEventListener('online', onOnline);

    const onVisibilityChange = (): void => {
      if (runtimeDocument.visibilityState === 'visible') {
        void this.syncWithServer();
      }
    };
    runtimeDocument.addEventListener('visibilitychange', onVisibilityChange);
    this.removeVisibilityListener = () =>
      runtimeDocument.removeEventListener('visibilitychange', onVisibilityChange);
  }
}
