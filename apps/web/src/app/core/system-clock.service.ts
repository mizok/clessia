import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

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
