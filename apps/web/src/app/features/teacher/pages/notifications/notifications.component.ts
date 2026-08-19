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

  protected readonly unread = computed(
    () => this.announcements().filter((a) => !a.isRead).length,
  );

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

  private setRead(id: string, isRead: boolean): void {
    this.announcements.update((list) =>
      list.map((a) => (a.id === id ? { ...a, isRead } : a)),
    );
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
