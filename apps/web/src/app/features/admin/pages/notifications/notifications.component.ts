import { DatePipe, Location } from '@angular/common';
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
import { ActivatedRoute, Router } from '@angular/router';
import { ReloadVeilComponent } from '@shared/components/reload-veil/reload-veil.component';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';

import {
  AUDIENCE_LABELS,
  AnnouncementsService,
  type Announcement,
  type AnnouncementAudience,
} from '@core/announcements.service';
import { AuthService } from '@core/auth.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { InboxBadgeService } from '@core/inbox-badge.service';
import { NotificationsService, type AppNotification } from '@core/notifications.service';
import { addDaysToDateString, taipeiDateString } from '@core/system-clock.service';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { RouteObj } from '@core/smart-enums/routes-catalog';

type Tab = 'inbox' | 'publish';

/** 通知 kind → 列上的類型、圖示、連結字（A6 `.nt__k`、`.nt__body .btn`）；沒列到的是「系統通知」 */
const KINDS: Record<string, { label: string; icon: string; go: string }> = {
  application_received: { label: '新申請', icon: 'pi-inbox', go: '看申請' },
  overdue_digest: { label: '逾期帳單', icon: 'pi-exclamation-circle', go: '看逾期帳單' },
  unbilled_reminder: { label: '待開單', icon: 'pi-file', go: '看帳單' },
  // #1023：連到課務異動頁（列表），不是單堂
  schedule_change: { label: '課務異動', icon: 'pi-calendar', go: '看課務異動' },
  leave_for_my_class: { label: '請假', icon: 'pi-user-minus', go: '看請假' },
  leave_received: { label: '家長請假', icon: 'pi-user-minus', go: '看請假' },
  // #1732：連到學生檔案的帳單章（#billing）
  leave_streak: { label: '連續請假', icon: 'pi-calendar-minus', go: '看明細' },
  // #1820：升級日前提醒，連到設定「一般」分頁的學年升級段
  grade_promotion_reminder: { label: '學年升級', icon: 'pi-arrow-up', go: '到設定預覽' },
  // #1821：連到申請頁對應的分頁（?kind=）
  application_overdue: { label: '申請待處理', icon: 'pi-clock', go: '看申請' },
  trial_followup: { label: '試聽跟進', icon: 'pi-phone', go: '看試聽' },
};
const OTHER_KIND = { label: '系統通知', icon: 'pi-bell', go: '前往' };

@Component({
  selector: 'app-notifications',
  imports: [
    ReloadVeilComponent,
    DatePipe,
    FormsModule,
    ChapterHeadComponent,
    PageActionsComponent,
    PageOpenComponent,
    SelectFieldComponent,
  ],
  templateUrl: './notifications.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  readonly page = input.required<RouteObj>();

  private readonly announcementsService = inject(AnnouncementsService);
  private readonly campusesService = inject(CampusesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messageService = inject(MessageService);
  private readonly auth = inject(AuthService);
  private readonly notificationsService = inject(NotificationsService);
  private readonly badge = inject(InboxBadgeService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /**
   * 兩個分頁（A6）：「收到的」（預設）／「發布公告」。網址 `#publish` 直接開發布分頁；
   * 切分頁只換網址的 hash（`replaceState`），不進上一頁的歷史。
   * 沒有 `send_announcements` 的管理員一樣看得到兩個分頁，發布分頁對他是唯讀清單（#1692 gate）。
   */
  protected readonly tab = signal<Tab>(
    inject(ActivatedRoute).snapshot.fragment === 'publish' ? 'publish' : 'inbox',
  );

  protected setTab(tab: Tab): void {
    if (this.tab() === tab) return;
    this.viewTransition(() => this.tab.set(tab));
    this.location.replaceState(this.location.path(false) + (tab === 'publish' ? '#publish' : ''));
  }

  // ── 收到的（#1692）：管理員自己的通知（#1693 寫入、#1703 讀取） ──

  protected readonly inboxLoading = signal(true);
  protected readonly inboxError = signal(false);
  protected readonly received = signal<AppNotification[]>([]);
  /** 伺服器的未讀數（清單最多 100 則，不數畫面上的） */
  protected readonly unread = signal(0);
  /** 標已讀失敗時那一行 */
  protected readonly markError = signal<string | null>(null);

  protected kindOf(kind: string): { label: string; icon: string; go: string } {
    return KINDS[kind] ?? OTHER_KIND;
  }

  /**
   * 依「今天／昨天／這週／更早」分章（A6），日期用台北時區切。
   * 「這週」＝今天往前 6 天內（A6 `d > addDays(T, -7)`），不是日曆週。
   */
  protected readonly inboxChapters = computed(() => {
    const today = taipeiDateString(Date.now());
    const yesterday = addDaysToDateString(today, -1);
    const weekStart = addDaysToDateString(today, -6);
    const names = ['今天', '昨天', '這週', '更早'] as const;
    const groups = new Map<string, AppNotification[]>(names.map((n) => [n, []]));
    for (const item of this.received()) {
      const day = taipeiDateString(Date.parse(item.createdAt));
      const name =
        day >= today ? '今天' : day === yesterday ? '昨天' : day >= weekStart ? '這週' : '更早';
      groups.get(name)!.push(item);
    }
    return names
      .map((name) => {
        const items = groups.get(name)!;
        return { name, items, unread: items.filter((i) => !i.isRead).length };
      })
      .filter((c) => c.items.length > 0);
  });

  /** 色面句（收到的）：「N 則未讀，／今天 M 則新通知。」，全部讀過「通知都看過了。」 */
  private readonly inboxHeadline = computed<{ first: string; second: string | null } | null>(() => {
    if (this.inboxLoading() || this.inboxError()) return null;
    if (this.received().length === 0) return { first: '還沒有收到通知。', second: null };
    const u = this.unread();
    if (u === 0) return { first: '通知都看過了。', second: null };
    const today = this.inboxChapters().find((c) => c.name === '今天')?.items.length ?? 0;
    return { first: `${u} 則未讀，`, second: `今天 ${today} 則新通知。` };
  });

  /** 展開＝已讀（A6）。只在打開時算，收起來不動 */
  protected onToggle(event: Event, item: AppNotification): void {
    if ((event.target as HTMLDetailsElement).open && !item.isRead) this.markRead(item);
  }

  /** 通知的連結是站內路徑（`/admin/billing`…），走 router 不整頁重載 */
  protected go(event: MouseEvent, link: string): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void this.router.navigateByUrl(link);
  }

  /**
   * 樂觀更新，失敗翻回。**請求不掛 `takeUntilDestroyed`**：展開後馬上點連結離開頁面，
   * 元件 destroy 會把 POST 一起取消、DB 沒寫進去（#1710 實機抓到）。翻回時直接寫角標。
   */
  private markRead(item: AppNotification): void {
    this.markError.set(null);
    this.setRead([item.id], true, 1);
    this.notificationsService.markRead(item.id).subscribe({
      error: () => {
        this.setRead([item.id], false, 1);
        this.markError.set('沒標成已讀，請稍後再試。');
      },
    });
  }

  /**
   * 全部標為已讀（原子，一句 UPDATE）。沒有「標回未讀」的 API，所以不做復原；
   * 成功後用 toast 說清楚標了幾則（#1692 gate：不能按下去就默默清掉）。
   */
  protected markAllRead(): void {
    const count = this.unread();
    if (count === 0) return;
    const ids = this.received()
      .filter((i) => !i.isRead)
      .map((i) => i.id);
    this.markError.set(null);
    this.setRead(ids, true, count);
    this.notificationsService.markAllRead().subscribe({
      next: (res) =>
        // A6 `A2.toast('已把 N 則標為已讀')` 一行字（稿上的「復原」不做，見上）
        this.messageService.add({ severity: 'success', summary: `已把 ${res.marked} 則標為已讀` }),
      error: () => {
        this.setRead(ids, false, count);
        this.markError.set('沒有標成已讀，請再按一次。');
      },
    });
  }

  /** 標已讀／翻回；未讀數跟著動 `delta`，並寫回頂欄角標（不另外打） */
  private setRead(ids: string[], isRead: boolean, delta: number): void {
    const set = new Set(ids);
    this.received.update((list) => list.map((i) => (set.has(i.id) ? { ...i, isRead } : i)));
    this.unread.update((n) => Math.max(0, n + (isRead ? -delta : delta)));
    this.badge.setNotificationsUnread(this.unread());
  }

  private loadInbox(): void {
    this.notificationsService
      .inbox()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.received.set(res.data);
          this.unread.set(res.meta.unread);
          this.badge.setNotificationsUnread(res.meta.unread);
          this.inboxLoading.set(false);
        },
        error: () => {
          this.inboxError.set(true);
          this.inboxLoading.set(false);
        },
      });
  }

  /**
   * #1686：發布要「發送通知」權限。沒有的人照樣進得來、看得到已發布的公告（使用者裁定），
   * 只是看不到發布入口。API 那邊的 POST 也會回 403 —— 這裡只是不讓人填完才被拒。
   */
  protected readonly canSend = computed(() => this.auth.hasPermission('send_announcements'));

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly bodyInput = viewChild<ElementRef<HTMLTextAreaElement>>('bodyInput');
  private readonly composer = viewChild<ElementRef<HTMLDialogElement>>('composer');

  /** 頁面的主要行動（#1689）：發布表單在彈窗裡，不在頁面上 */
  protected readonly sendAction: PageAction = { label: '發送通知', icon: 'pi pi-send' };

  protected readonly AUDIENCE_LABELS = AUDIENCE_LABELS;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  private readonly viewTransition = injectViewTransition();
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

  /**
   * 色面句：已發布幾則、上一則是哪天（台北），A6 兩行（`<br>` 接在兩段中間）。
   * 還沒載到回 `null`，由模板退回頁名
   */
  protected readonly headline = computed(() =>
    this.tab() === 'inbox' ? this.inboxHeadline() : this.publishHeadline(),
  );

  private readonly publishHeadline = computed<{
    first: string;
    second: string | null;
  } | null>(() => {
    if (this.loading() || this.loadError()) return null;
    const items = this.announcements();
    if (items.length === 0) return { first: '還沒有發布過公告。', second: null };
    const latest = items.reduce((a, b) => (a.publishedAt > b.publishedAt ? a : b));
    const day = taipeiDateString(Date.parse(latest.publishedAt));
    return {
      first: `已發布 ${items.length} 則公告，`,
      second: `上一則是 ${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}。`,
    };
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

  protected onAudienceChange(value: AnnouncementAudience | null): void {
    if (value) this.audience.set(value);
  }

  protected openComposer(): void {
    this.composer()?.nativeElement.showModal();
  }

  /** 關掉不清草稿 —— 再打開時內容還在，送出成功才清空 */
  protected closeComposer(): void {
    this.composer()?.nativeElement.close();
  }

  /** 點背景關掉：dialog 沒有內距，點到 dialog 本身就是點到 backdrop */
  protected onComposerBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeComposer();
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
    this.loadInbox();
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
          this.closeComposer();
          this.load({ rows: true });
        },
        error: () => {
          this.submitting.set(false);
          this.submitError.set('發布失敗，請稍後再試');
        },
      });
  }

  /** `rows`：發布後的重抓，新的那則淡入（#1641 5b）；重抓期間舊的公告留著變淡 */
  private load({ rows = false }: { rows?: boolean } = {}): void {
    this.loading.set(true);
    this.loadError.set(false);

    this.announcementsService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.viewTransition(
            () => {
              this.announcements.set(res.data);
              this.loading.set(false);
            },
            { rows },
          );
        },
        error: () => {
          this.announcements.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }
}
