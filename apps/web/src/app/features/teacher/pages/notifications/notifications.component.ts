import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-notifications',
  imports: [DatePipe],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();

  private readonly announcementsService = inject(AnnouncementsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly announcements = signal<Announcement[]>([]);
  /** 展開中的公告；展開即視為已讀 */
  protected readonly openId = signal<string | null>(null);

  protected readonly unread = computed(() => this.announcements().filter((a) => !a.isRead).length);

  constructor() {
    this.load();
  }

  protected toggle(announcement: Announcement): void {
    const next = this.openId() === announcement.id ? null : announcement.id;
    this.openId.set(next);

    if (next && !announcement.isRead) this.markRead(announcement);
  }

  /**
   * 樂觀更新：先把畫面標成已讀，再送請求。
   * 失敗就翻回未讀 —— 顯示成已讀但實際沒存到，下次進來又冒出來才是更糟的體驗。
   */
  private markRead(announcement: Announcement): void {
    this.setRead(announcement.id, true);

    this.announcementsService
      .markRead(announcement.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.setRead(announcement.id, false) });
  }

  /**
   * 全部標為已讀 —— 一次呼叫 `POST /api/announcements/read-all`（#219）。
   *
   * **這裡曾經是對未讀逐一呼叫**，因為當時後端只有 `POST /{id}/read`。
   * 換成批次端點拿回兩件事：30 則從 30 次往返變成 1 次，以及**原子性** ——
   * 逐一版中途失敗會留下一半已讀，而使用者看到的是「按了但紅點還在」。
   *
   * 樂觀更新照舊，但翻回的範圍變了：原子端點沒有「部分失敗」，
   * 所以失敗時**翻回這次標的全部**，不是翻回失敗的那幾則。
   * 記下 `ids` 而不是重掃一次未讀 —— 送出後畫面上已經沒有未讀了。
   */
  protected markAllRead(): void {
    const ids = this.announcements()
      .filter((a) => !a.isRead)
      .map((a) => a.id);
    if (ids.length === 0) return;

    for (const id of ids) this.setRead(id, true);

    this.announcementsService
      .markAllRead()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          for (const id of ids) this.setRead(id, false);
        },
      });
  }

  private setRead(id: string, isRead: boolean): void {
    this.announcements.update((list) => list.map((a) => (a.id === id ? { ...a, isRead } : a)));
  }

  private load(): void {
    this.announcementsService
      .inbox()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.announcements.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.announcements.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }
}
