import { ValueArriveDirective } from '@shared/directives/value-arrive.directive';
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
import { Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { map as rxMap, type Observable } from 'rxjs';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
import { InboxBadgeService } from '@core/inbox-badge.service';
import {
  NotificationsService,
  type AppNotification,
  type ChangeDetailRow,
  type ChangeSlot,
} from '@core/notifications.service';
import { addDaysToDateString, taipeiDateString } from '@core/system-clock.service';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

type Source = 'announcement' | 'notification';

/** 收件匣的一列 —— 公告與通知合併成同一個形狀 */
export interface InboxItem {
  readonly source: Source;
  readonly id: string;
  /** 列上的標籤：「公告」「繳費提醒」… */
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly at: string;
  readonly isRead: boolean;
  /** 公告的分校名 */
  readonly campusName: string | null;
  readonly author: string | null;
  /** 通知點了要去的頁 */
  readonly link: string | null;
  /** 課務異動：點了展開「原本／改為」＋「看課表」，不直接導頁（#1100 #49，A6 p-notifications） */
  readonly hasChangeDetail: boolean;
}

/** 通知 kind → 列上的標籤（#1683）；沒列到的寫「通知」 */
const KIND_LABELS: Record<string, string> = {
  invoice_due: '繳費提醒',
  invoice_overdue: '繳費提醒',
  schedule_change: '課務異動',
  leave_for_my_class: '請假',
  leave_received: '請假',
  leave_streak: '連續請假',
  enrollment_approved: '報名',
  enrollment_completed: '報名',
};

const SOURCE_NAMES: Record<Source, string> = { announcement: '公告', notification: '通知' };

function fromAnnouncement(a: Announcement): InboxItem {
  return {
    source: 'announcement',
    id: a.id,
    label: '公告',
    title: a.title,
    body: a.body,
    at: a.publishedAt,
    isRead: a.isRead,
    campusName: a.campusName,
    author: a.createdByName,
    link: null,
    hasChangeDetail: false,
  };
}

function fromNotification(n: AppNotification): InboxItem {
  return {
    source: 'notification',
    id: n.id,
    label: KIND_LABELS[n.kind] ?? '通知',
    title: n.title,
    body: n.body,
    at: n.createdAt,
    isRead: n.isRead,
    campusName: null,
    author: null,
    link: n.link,
    hasChangeDetail: n.hasChangeDetail,
  };
}

/**
 * 收件匣 —— **老師與家長是同一個東西**。公告＋通知（#1688）依時間合併成一份清單（#1683）。
 *
 * - 公告：展開就算已讀
 * - 通知：點了先標已讀，有 `link` 就導過去，沒有就展開
 * - 一個來源讀取失敗：另一邊照樣顯示，失敗那邊寫一行「暫時讀不到」；兩邊都失敗才整頁錯誤
 * - 全部標為已讀：兩支 `read-all` 平行打，各自原子、合起來不是 —— 一邊失敗只翻那一邊
 * - 未讀數用伺服器的 `meta.unread`（通知清單最多 100 則，數畫面上的會少算），
 *   讀到或標了已讀就寫回頂欄角標（`InboxBadgeService`），角標不另外打
 *
 * `GET /api/announcements` 的 `audienceFor(roles)` 依角色回 `all_teachers` /
 * `all_parents`（`routes/announcements/visibility.ts`），所以前端不需要知道
 * 自己是誰：同一支端點、同一份畫面，伺服器決定看得到什麼。
 *
 * **#291 已修（2026-09-05）**：`audienceFor` 現在先看 `activeRole`（`auth.interceptor.ts`
 * 附的 `X-Active-Role` header，`authMiddleware` 驗證後放進 context），找不到才退回
 * 角色陣列的優先序。同時是老師又是家長的人切到家長身分時，看到的是家長的公告。
 * 見 kb/wiki/architecture/parent-data-scope.md 第四節。
 *
 * **抽在 shared/ 而不是各角色抄一份**：feature 之間不得互相 import（c5），
 * 而兩份同樣的收件匣遲早會各自長出東西 —— 這個 codebase 已經為此收斂過三組
 * （點名兩份、成績鍵盤兩份、匯入解析兩份）。
 */
@Component({
  selector: 'app-announcement-inbox',
  imports: [
    SkeletonComponent,
    DatePipe,
    ValueArriveDirective,
    PageOpenComponent,
    ChapterHeadComponent,
    RouterLink,
  ],
  templateUrl: './announcement-inbox.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnouncementInboxComponent {
  /** 頁面標題 —— 由呼叫端給，因為老師與家長的選單標籤不一樣；色面句還沒算出來時顯示它 */
  readonly heading = input.required<string>();

  private readonly announcementsService = inject(AnnouncementsService);
  private readonly notificationsService = inject(NotificationsService);
  private readonly badge = inject(InboxBadgeService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly api: Record<
    Source,
    {
      inbox(): Observable<{ data: InboxItem[]; meta: { unread: number } }>;
      markRead(id: string): Observable<unknown>;
      markAllRead(): Observable<{ marked: number }>;
    }
  > = {
    announcement: {
      inbox: () => mapInbox(this.announcementsService.inbox(), fromAnnouncement),
      markRead: (id) => this.announcementsService.markRead(id),
      markAllRead: () => this.announcementsService.markAllRead(),
    },
    notification: {
      inbox: () => mapInbox(this.notificationsService.inbox(), fromNotification),
      markRead: (id) => this.notificationsService.markRead(id),
      markAllRead: () => this.notificationsService.markAllRead(),
    },
  };

  protected readonly loading = signal(true);
  private readonly lists = signal<Record<Source, InboxItem[]>>({
    announcement: [],
    notification: [],
  });
  /** 伺服器的未讀數；null＝還沒讀到或讀取失敗（不寫回角標，角標保留它自己的值） */
  private readonly unreadBy = signal<Record<Source, number | null>>({
    announcement: null,
    notification: null,
  });
  private readonly failed = signal<Source[]>([]);
  /** 全部標為已讀時有一邊失敗 */
  protected readonly markAllPartial = signal(false);

  protected readonly items = computed(() => {
    const { announcement, notification } = this.lists();
    return [...announcement, ...notification].sort((a, b) => b.at.localeCompare(a.at));
  });
  protected readonly loadError = computed(() => this.failed().length === 2);
  /** 只有一邊失敗時那一行 */
  protected readonly partialError = computed(() => {
    const f = this.failed();
    return f.length === 1 ? `${SOURCE_NAMES[f[0]!]}暫時讀不到，請稍後再試。` : null;
  });
  protected readonly unread = computed(() => {
    const u = this.unreadBy();
    return (u.announcement ?? 0) + (u.notification ?? 0);
  });
  /**
   * 依「今天／昨天／這週／更早」分章（A6，同管理端通知中心），日期用台北時區切。
   * 「這週」＝今天往前 6 天內（A6 `d > addDays(T, -7)`），不是日曆週。
   */
  protected readonly chapters = computed(() => {
    const today = taipeiDateString(Date.now());
    const yesterday = addDaysToDateString(today, -1);
    const weekStart = addDaysToDateString(today, -6);
    const names = ['今天', '昨天', '這週', '更早'] as const;
    const groups = new Map<string, InboxItem[]>(names.map((n) => [n, []]));
    for (const item of this.items()) {
      const day = taipeiDateString(Date.parse(item.at));
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

  /**
   * 色面句：「N 則未讀，／今天 M 則新通知。」，全部讀過「通知都看過了。」（A6 p-notifications）。
   * 老師稿寫「新公告／公告都看過了」，但 #1683 起老師收件匣也有通知，兩邊一律寫「通知」（計畫席 10-22）。
   * 還沒載到、或整頁失敗回 `null`，模板退回頁名。
   */
  protected readonly headline = computed<{ first: string; second: string | null } | null>(() => {
    if (this.loading() || this.loadError()) return null;
    if (this.items().length === 0) return { first: '還沒有收到通知。', second: null };
    const u = this.unread();
    if (u === 0) return { first: '通知都看過了。', second: null };
    const today = this.chapters().find((c) => c.name === '今天')?.items.length ?? 0;
    return { first: `${u} 則未讀，`, second: `今天 ${today} 則新通知。` };
  });

  /** 展開中的那一列（`source:id`）；公告展開即視為已讀 */
  protected readonly openKey = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected keyOf(item: InboxItem): string {
    return `${item.source}:${item.id}`;
  }

  /** 課務異動的原本／改為：通知 id → 讀到的列、讀取中、讀取失敗。展開才讀，讀過就留著 */
  protected readonly changeDetail = signal<
    Record<string, ChangeDetailRow[] | 'loading' | 'failed'>
  >({});

  /** `2026-10-08`＋`15:30`＋老師 → 「10/8（四）15:30 · 王老師」 */
  protected slotText(slot: ChangeSlot): string {
    const [y, m, d] = slot.date.split('-').map(Number);
    const wd = '日一二三四五六'[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()];
    return [
      `${m}/${d}（${wd}）${slot.startTime ?? ''}`.trim(),
      slot.teacherName && `${slot.teacherName}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private loadChangeDetail(id: string): void {
    const state = this.changeDetail()[id];
    if (state && state !== 'failed') return;
    this.changeDetail.update((m) => ({ ...m, [id]: 'loading' }));
    this.notificationsService
      .changeDetail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.changeDetail.update((m) => ({ ...m, [id]: res.data })),
        error: () => this.changeDetail.update((m) => ({ ...m, [id]: 'failed' })),
      });
  }

  protected toggle(item: InboxItem): void {
    if (!item.isRead) this.markRead(item);
    if (item.source === 'notification' && item.hasChangeDetail) {
      const key = this.keyOf(item);
      const opening = this.openKey() !== key;
      this.openKey.set(opening ? key : null);
      if (opening) this.loadChangeDetail(item.id);
      return;
    }
    if (item.source === 'notification' && item.link) {
      void this.router.navigateByUrl(item.link);
      return;
    }
    const key = this.keyOf(item);
    this.openKey.set(this.openKey() === key ? null : key);
  }

  /**
   * 樂觀更新：先把畫面標成已讀，再送請求。
   * 失敗就翻回未讀 —— 顯示成已讀但實際沒存到，下次進來又冒出來才是更糟的體驗。
   *
   * **標已讀的請求不跟元件同生死**（不掛 `takeUntilDestroyed`）：點有 `link` 的通知會馬上導頁、
   * 元件跟著 destroy，掛了的話 POST 會被取消，回來還是未讀（#1683 第二段實機抓到）。
   * 翻回時角標也一起翻（`setRead` 直接寫角標，不靠元件的 effect）。
   */
  private markRead(item: InboxItem): void {
    this.setRead(item.source, [item.id], true);

    this.api[item.source]
      .markRead(item.id)
      .subscribe({ error: () => this.setRead(item.source, [item.id], false) });
  }

  /**
   * 全部標為已讀 —— 每個來源一次 `read-all`（#219），兩支平行打。
   *
   * 每一支是**原子**的，所以失敗時翻回**那一支這次標的全部**（送出前記下的 ids，
   * 不是重掃未讀 —— 樂觀更新之後畫面上已經沒有未讀了）。
   * 兩支合起來**不是**原子：一邊失敗只翻那一邊，畫面寫「有一部分沒標成」。
   */
  protected markAllRead(): void {
    this.markAllPartial.set(false);
    // 兩支都回來之後 toast 一行「已把 N 則標為已讀」，N 是伺服器實際標的數（A6；稿上的「復原」不做，沒有標回未讀的 API）
    const jobs = (['announcement', 'notification'] as const)
      .map((source) => ({
        source,
        count: this.unreadBy()[source] ?? 0,
        ids: this.lists()
          [source].filter((i) => !i.isRead)
          .map((i) => i.id),
      }))
      .filter((j) => j.count > 0 || j.ids.length > 0);
    // 先數好要送幾支再送：回應可能同步回來（cache、測試替身），邊送邊數會在第一支就 toast
    let pending = jobs.length;
    let marked = 0;
    const settle = () => {
      if (--pending === 0 && marked > 0)
        this.messageService.add({ severity: 'success', summary: `已把 ${marked} 則標為已讀` });
    };
    for (const { source, count, ids } of jobs) {
      this.setRead(source, ids, true, count);
      // 同 markRead：按完馬上離開頁面也要送得到
      this.api[source].markAllRead().subscribe({
        next: (res) => {
          marked += res.marked;
          settle();
        },
        error: () => {
          this.setRead(source, ids, false, count);
          this.markAllPartial.set(true);
          settle();
        },
      });
    }
  }

  /** 標已讀／翻回；`delta` 是未讀數要跟著動多少（預設＝這次動的列數） */
  private setRead(source: Source, ids: string[], isRead: boolean, delta = ids.length): void {
    const set = new Set(ids);
    this.lists.update((l) => ({
      ...l,
      [source]: l[source].map((i) => (set.has(i.id) ? { ...i, isRead } : i)),
    }));
    this.unreadBy.update((u) => {
      const n = u[source];
      if (n === null) return u;
      return { ...u, [source]: Math.max(0, n + (isRead ? -delta : delta)) };
    });
    this.syncBadge(source);
  }

  /** 頂欄角標跟著這裡的數字走，不另外打。讀取失敗那邊（null）不寫，角標保留它自己抓到的值 */
  private syncBadge(source: Source): void {
    const n = this.unreadBy()[source];
    if (n === null) return;
    if (source === 'announcement') this.badge.setAnnouncementsUnread(n);
    else this.badge.setNotificationsUnread(n);
  }

  private load(): void {
    let pending = 2;
    const done = () => {
      if (--pending === 0) this.loading.set(false);
    };
    for (const source of ['announcement', 'notification'] as const) {
      this.api[source]
        .inbox()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.lists.update((l) => ({ ...l, [source]: res.data }));
            this.unreadBy.update((u) => ({ ...u, [source]: res.meta.unread }));
            this.syncBadge(source);
            done();
          },
          error: () => {
            this.failed.update((f) => [...f, source]);
            done();
          },
        });
    }
  }
}

function mapInbox<T>(
  res$: Observable<{ data: T[]; meta: { unread: number } }>,
  map: (row: T) => InboxItem,
): Observable<{ data: InboxItem[]; meta: { unread: number } }> {
  return res$.pipe(rxMap((res) => ({ data: res.data.map(map), meta: res.meta })));
}
