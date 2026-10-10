import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';

import {
  AUDIENCE_LABELS,
  AnnouncementsService,
  type Announcement,
  type AnnouncementAudience,
} from '@core/announcements.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { taipeiDateString } from '@core/system-clock.service';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { RouteObj } from '@core/smart-enums/routes-catalog';

@Component({
  selector: 'app-notifications',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    SelectModule,
    ToastModule,
    ChapterHeadComponent,
    PageOpenComponent,
  ],
  providers: [MessageService],
  templateUrl: './notifications.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();

  private readonly announcementsService = inject(AnnouncementsService);
  private readonly campusesService = inject(CampusesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messageService = inject(MessageService);

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly bodyInput = viewChild<ElementRef<HTMLTextAreaElement>>('bodyInput');

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
  protected readonly audienceOptions = (['all_teachers', 'all_parents'] as const).map((value) => ({
    label: AUDIENCE_LABELS[value],
    value,
  }));

  /**
   * 已發布依**月份**分章（A6、#1314 NT3）。月份用台北時區切 —— 不是瀏覽器本地：
   * 晚上 11 點發的公告在海外瀏覽器會落到隔天，月底那一則就跑到下個月的章。
   * API 本來就是新到舊，這裡再排一次是為了不依賴它；跨年才在章名加年份。
   */
  protected readonly chapters = computed(() => {
    const currentYear = taipeiDateString(Date.now()).slice(0, 4);
    const groups = new Map<string, { key: string; name: string; items: Announcement[] }>();
    const sorted = [...this.announcements()].sort((a, b) =>
      b.publishedAt.localeCompare(a.publishedAt),
    );
    for (const item of sorted) {
      const key = taipeiDateString(Date.parse(item.publishedAt)).slice(0, 7);
      let group = groups.get(key);
      if (!group) {
        const [year, month] = key.split('-');
        group = {
          key,
          name: `${year === currentYear ? '' : `${year} 年 `}${Number(month)} 月`,
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    return [...groups.values()];
  });

  /** 色面句：已發布幾則、上一則是哪天（台北）。還沒載到回 `null`，由模板退回頁名 */
  protected readonly headline = computed(() => {
    if (this.loading() || this.loadError()) return null;
    const items = this.announcements();
    if (items.length === 0) return '還沒有發布過公告。';
    const latest = items.reduce((a, b) => (a.publishedAt > b.publishedAt ? a : b));
    const day = taipeiDateString(Date.parse(latest.publishedAt));
    return `已發布 ${items.length} 則公告，上一則是 ${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}。`;
  });

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

    if (!this.title().trim()) found['title'] = '標題還沒填';
    if (!this.body().trim()) found['body'] = '內容還沒填';

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
    if (firstError) {
      // 第一個有錯的欄位拿到焦點 —— 錯誤字在欄位旁，但使用者的游標不一定在那附近
      (firstError === 'title' ? this.titleInput() : this.bodyInput())?.nativeElement.focus();
      return;
    }

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
          const campus = this.campusOptions().find((o) => o.value === this.campusId())?.label;
          this.messageService.add({
            severity: 'success',
            summary: '已發布',
            detail: `已發布給${AUDIENCE_LABELS[this.audience()]}（${campus ?? '全部分校'}）`,
          });
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
