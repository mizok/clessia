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
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';

import {
  AUDIENCE_LABELS,
  AnnouncementsService,
  type Announcement,
  type AnnouncementAudience,
} from '@core/announcements.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-notifications',
  imports: [DatePipe, FormsModule, ButtonModule, SelectModule],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();

  private readonly announcementsService = inject(AnnouncementsService);
  private readonly campusesService = inject(CampusesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly AUDIENCE_LABELS = AUDIENCE_LABELS;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly campuses = signal<Campus[]>([]);

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly campusId = signal<string | null>(null);

  /**
   * **2026-09-12（#636）解鎖。** 原本寫死成 `'all_teachers'`，理由是：
   *
   * > 家長端 11 個頁面全是空殼，發給家長的公告不會有人看得到 ——
   * > 選得到但沒人收，比選不到更糟。schema 已經支援，**等家長端接上再開**。
   *
   * **那個「等 X 成立」的條件在 2026-09-04 就成立了** —— PR #291 把家長端通知中心
   * 接上了（`parent/pages/notifications` 渲染 `shared/components/announcement-inbox`，
   * 後端 `announcements/visibility.ts` 的 `audienceFor` 對 parent 回 `all_parents`）。
   *
   * **而註解沒有被回頭檢查，五天後是可用性測試撞出來的** —— 行政在 18 個任務裡
   * 有四處要跟家長說話（停課、缺席、催繳、成績），四處都卡在這個常數上。
   * 這是 `AGENTS.md` 那條「寫了『因為 X 所以這樣做』的決策，在 X 不再成立時
   * 也要被回頭檢查」的實例：**它礙事了五天才被發現，而發現它的不是那個條件本身。**
   *
   * **預設仍然是老師**（解鎖不等於改預設，#636 的邊界）。
   */
  protected readonly audience = signal<AnnouncementAudience>('all_teachers');

  /** 順序照 `AudienceSchema` 的宣告序，不要照字母序 —— 預設值排第一個 */
  protected readonly audienceOptions = (['all_teachers', 'all_parents'] as const).map(
    (value) => ({ label: AUDIENCE_LABELS[value], value }),
  );

  protected readonly campusOptions = computed(() => [
    { label: '全部分校', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);

  protected readonly canSubmit = computed(
    () => this.title().trim().length > 0 && this.body().trim().length > 0 && !this.submitting(),
  );

  constructor() {
    this.campusesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.campuses.set(res.data),
        error: () => this.campuses.set([]),
      });

    this.load();
  }

  protected submit(): void {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.submitError.set(null);

    this.announcementsService
      .create({
        title: this.title().trim(),
        body: this.body().trim(),
        audience: this.audience(),
        campusId: this.campusId(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.title.set('');
          this.body.set('');
          this.submitting.set(false);
          this.load();
        },
        error: () => {
          this.submitting.set(false);
          this.submitError.set('發布失敗，請稍後再試');
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(false);

    this.announcementsService
      .list()
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
