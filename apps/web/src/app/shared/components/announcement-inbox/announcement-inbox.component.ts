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

/**
 * 公告收件匣 —— **老師與家長是同一個東西**。
 *
 * `GET /api/announcements` 的 `audienceFor(roles)` 依角色回 `all_teachers` /
 * `all_parents`（`routes/announcements/visibility.ts`），所以前端不需要知道
 * 自己是誰：同一支端點、同一份畫面，伺服器決定看得到什麼。
 *
 * **已知限制（計畫席裁定照現行為出貨）**：`audienceFor` 是
 * `roles.includes('teacher')` 優先，而 `auth.ts` 放進 context 的是**全部角色的
 * 陣列**不是 `activeRole` —— 所以**同時是老師又是家長的人（補習班老師的小孩也在
 * 補習班）切到家長身分時，看到的仍是老師的公告，而且不會知道自己漏了什麼**。
 * 正解要 `activeRole` 進 API context，那是授權模型設計的一部分，等使用者裁。
 *
 * **抽在 shared/ 而不是各角色抄一份**：feature 之間不得互相 import（c5），
 * 而兩份同樣的收件匣遲早會各自長出東西 —— 這個 codebase 已經為此收斂過三組
 * （點名兩份、成績鍵盤兩份、匯入解析兩份）。
 *
 * **老師端目前還是自己那一份**（`features/teacher/pages/notifications`）。
 * 那是 teacher-pages 席的檔案，改用這支是它的一行改動 —— 不在這支 PR 的範圍。
 */
@Component({
  selector: 'app-announcement-inbox',
  imports: [DatePipe],
  templateUrl: './announcement-inbox.component.html',
  styleUrl: './announcement-inbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnouncementInboxComponent {
  /** 頁面標題 —— 由呼叫端給，因為老師與家長的選單標籤不一樣 */
  readonly heading = input.required<string>();

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
