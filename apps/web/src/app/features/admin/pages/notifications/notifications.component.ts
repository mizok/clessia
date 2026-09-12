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

  /**
   * 欄位級錯誤 —— **上次按「發布」時的驗證結果**，不是永久標籤。
   * 改動那個欄位就清掉（`onTitleChange` / `onBodyChange`）。
   */
  protected readonly errors = signal<Record<string, string>>({});

  /**
   * **一次收集全部**而不是遇到第一個就 return —— 使用者一次看到所有要補的東西，
   * 不用「修一個、再按一次、再發現下一個」。（照 #664 的形狀）
   */
  private validate(): string | null {
    const found: Record<string, string> = {};

    if (!this.title().trim()) found['title'] = '請填寫標題';
    if (!this.body().trim()) found['body'] = '請填寫內容';

    this.errors.set(found);
    return Object.keys(found)[0] ?? null;
  }

  /** 改動一個欄位就清掉它的錯誤 */
  private clearError(field: string): void {
    if (!this.errors()[field]) return;
    this.errors.update((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
  }

  protected onTitleChange(value: string): void {
    this.title.set(value);
    this.clearError('title');
  }

  protected onBodyChange(value: string): void {
    this.body.set(value);
    this.clearError('body');
  }

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

  /**
   * **這顆按鈕刻意只在 `submitting()` 時 disable。**（#723，照 #664／#718 的判準）
   *
   * 原本是 `[disabled]="!canSubmit()"` —— 標題或內容沒填時**按下去什麼都不會發生**：
   * 沒有欄位標記、沒有任何解釋。
   *
   * **`disabled` 是把「為什麼不行」藏起來，而那正是使用者最需要知道的。
   * 按不下去的按鈕不會解釋原因，按得下去的才會。**
   * `submitting()` 期間仍然 disable —— 那時候按下去**會**產生後果（重複發布）。
   */
  protected submit(): void {
    const firstError = this.validate();
    if (firstError) return;

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
