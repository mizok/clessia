import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { AnnouncementsService } from './announcements.service';
import { AuthService } from './auth.service';
import { NotificationsService } from './notifications.service';

/** 回到前景時，距離上次抓至少這麼久才再抓（#1683 計畫席 gate） */
export const FOREGROUND_REFRESH_MS = 60_000;

/**
 * 頂欄鈴鐺的未讀角標（#1683）。數字＝收件匣各來源的 `meta.unread` 加總。
 *
 * **不輪詢、不每頁打**：只在這幾個時間點抓 ——
 * - 身分出現或切換（`activeRole` 變了）：`audienceFor` 依 active role 決定收件匣，數字跟著變
 * - 回到前景（`visibilitychange` → visible），距離上次至少 `FOREGROUND_REFRESH_MS`
 * - 收件匣頁自己讀到、或標成已讀之後直接寫回（`setAnnouncementsUnread`／`setNotificationsUnread`）
 *
 * **兩個來源**：公告（只有老師、家長有收件匣）＋ 通知（#1688，三個角色都有，#1693）。
 * 管理員只算通知那一支，在通知中心的「收到的」分頁清掉（#1692）。兩支平行抓、各自獨立：
 * **一支讀取失敗只保留它自己的舊值**，另一支照常更新，角標不會因為一次網路失誤就消失（計畫席 gate）。
 * 只有切換身分時先歸零 —— 上一個身分的數字對新身分是錯的。
 *
 * ponytail: 公告 inbox 回的是全部公告的內文，只為了一個數字抓整份；公告多了再加只回數字的端點
 * （同一套 audienceFor／campusOrFilter，只 select id）。
 */
@Injectable({ providedIn: 'root' })
export class InboxBadgeService {
  private readonly auth = inject(AuthService);
  private readonly announcements = inject(AnnouncementsService);
  private readonly notifications = inject(NotificationsService);

  private readonly announcementsUnread = signal(0);
  private readonly notificationsUnread = signal(0);

  readonly unread = computed(() => this.announcementsUnread() + this.notificationsUnread());
  /** 老師、家長有公告收件匣；管理員只有通知（通知中心「收到的」，#1692） */
  readonly hasInbox = computed(() => {
    const role = this.auth.activeRole();
    return role === 'teacher' || role === 'parent';
  });

  private lastFetch = 0;

  constructor() {
    effect(() => {
      this.auth.activeRole();
      untracked(() => {
        this.announcementsUnread.set(0);
        this.notificationsUnread.set(0);
        this.refresh(true);
      });
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') this.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
  }

  /** `force`：不看間隔（身分切換時） */
  refresh(force = false): void {
    if (!this.auth.activeRole()) return;
    const now = Date.now();
    if (!force && now - this.lastFetch < FOREGROUND_REFRESH_MS) return;
    this.lastFetch = now;
    if (this.hasInbox()) {
      this.announcements.inbox().subscribe({
        next: (res) => this.announcementsUnread.set(res.meta.unread),
        error: () => undefined, // 保留舊值
      });
    }
    this.notifications.inbox().subscribe({
      next: (res) => this.notificationsUnread.set(res.meta.unread),
      error: () => undefined, // 保留舊值
    });
  }

  /** 收件匣頁自己讀到、或標成已讀之後寫回，不必再打一次 */
  setAnnouncementsUnread(count: number): void {
    this.announcementsUnread.set(Math.max(0, count));
  }

  setNotificationsUnread(count: number): void {
    this.notificationsUnread.set(Math.max(0, count));
  }
}
