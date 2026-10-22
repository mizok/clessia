import { ReloadVeilComponent } from '@shared/components/reload-veil/reload-veil.component';
import { HeightFollowDirective } from '@shared/directives/height-follow.directive';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Subject,
  firstValueFrom,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  forkJoin,
  of,
  skip,
  switchMap,
} from 'rxjs';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LeaveStreaksService } from '@core/leave-streaks.service';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { PopoverModule, type Popover } from 'primeng/popover';
import { FitPopoverDirective } from '@shared/directives/fit-popover.directive';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MessageService, type MenuItem } from 'primeng/api';
import { AppVersionService } from '@core/app-version.service';
import { DialogService } from 'primeng/dynamicdialog';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  INVOICE_STATUS_LABELS,
  InvoicesService,
  type Invoice,
  type InvoiceStatus,
  type InvoiceSummary,
} from '@core/invoices.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { SystemClockService } from '@core/system-clock.service';
import { CampusContextService } from '@core/campus-context.service';

import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { FilterToggleComponent } from '@shared/components/filter-toggle/filter-toggle.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { InvoiceDetailDialogComponent } from './invoice-detail-dialog/invoice-detail-dialog.component';
import { InvoiceActionsComponent } from './invoice-actions/invoice-actions.component';
import { PaymentFormDialogComponent } from './payment-form-dialog/payment-form-dialog.component';
import { InvoiceFormDialogComponent } from './invoice-form-dialog/invoice-form-dialog.component';
import { UninvoicedDialogComponent } from './uninvoiced-dialog/uninvoiced-dialog.component';
import {
  EXPORT_SCOPE_LABELS,
  invoiceExportRow,
  type ExportScope,
  daysOverdue,
  daysUntilDue,
  isOverdue,
  lastPaidOn,
  outstanding,
  overRefunded,
} from './payments.util';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';
import { TodoBannerComponent } from '@shared/components/todo-banner/todo-banner.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

const PAGE_SIZE = LIST_PAGE_SIZE;

type ChapterKey = 'dueSoon' | 'notDue' | 'paid';
const CHAPTER_KEYS: readonly ChapterKey[] = ['dueSoon', 'notDue', 'paid'];

interface ChapterState {
  open: boolean;
  loading: boolean;
  failed: boolean;
  rows: Invoice[];
  total: number;
  page: number;
}

// 還沒抓過就是「載入中」：給 false 的話 reload-veil 會當成已經載入過，第一次展開就走「重抓」——
// 載入中膠囊疊在空列表上、被下一章切掉（#1853）。第一次要顯示骨架
const emptyChapter = (): ChapterState => ({
  open: false,
  loading: true,
  failed: false,
  rows: [],
  total: 0,
  page: 1,
});

/**
 * 繳費紀錄 —— 見 kb/wiki/specs/admin/finance/payments.md 與
 * kb/wiki/architecture/admin-payments-page.md。
 *
 * **篩選一律打後端，前端不自己篩。** `status` 是推導值 DB 濾不掉，所以後端在帶了
 * `status` / `overdue` 時走「全撈 → 篩 → 自己切頁」那條路徑（`lib/derived-page.ts`）。
 * 前端要是自己篩就只篩得到當頁那 20 筆 —— 使用者會看到「未繳 3 筆」而真相是 47 筆。
 *
 * `status` 與 `overdue` **可以並用**：「部分繳 + 逾期」是常見組合，逾期是衍生標記
 * 不是第四種狀態（billing-rules 規則 4）。
 *
 * **分頁用 `meta.total`**（PR #64 之後兩條路徑的 total 都是篩後全體筆數）。
 */
@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [
    SkeletonComponent,
    ReloadVeilComponent,
    HeightFollowDirective,
    InvoiceActionsComponent,
    NgTemplateOutlet,
    PopupMenuComponent,
    RouterLink,
    FilterToggleComponent,
    StatusDotComponent,
    DecimalPipe,
    FormsModule,
    ButtonModule,
    SelectModule,
    SelectButtonModule,
    PaginatorModule,
    PageActionsComponent,
    PageOpenComponent,
    EmptyStateComponent,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    PopoverModule,
    FitPopoverDirective,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
    TodoBannerComponent,
  ],
  providers: [DialogService],
  templateUrl: './payments.page.html',
})
export class PaymentsPage implements OnInit {
  readonly page = input.required<RouteObj>();
  /** 營收報表的「看逾期帳單」帶過來的（#1314 RP3）：`?due=overdue|outstanding|dueSoon` */
  readonly due = input<string | undefined>();

  private readonly service = inject(InvoicesService);
  /** 重抓的資料平滑換上；帳本變動造成的重抓帶 rows（#1641 5b） */
  private readonly viewTransition = injectViewTransition();
  private reloadRows = false;
  /** 這一輪重抓要帶 rows 的章（`loadChapter` 設、回應套上時取走） */
  private readonly chapterReloadRows = new Set<ChapterKey>();
  private readonly destroyRef = inject(DestroyRef);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly campusCtx = inject(CampusContextService);

  /** 頂欄選的分校（#1314 帳單殼層）。`null`＝全部分校，不帶參數；範圍仍由後端判（c1） */
  private campusId(): string | undefined {
    return this.campusCtx.id() ?? undefined;
  }
  private readonly messageService = inject(MessageService);
  private readonly version = inject(AppVersionService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly INVOICE_STATUS_LABELS = INVOICE_STATUS_LABELS;

  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  /**
   * 催繳篩選的三選一(#639)。**取代原本的兩態切換鈕** —— 那顆按鈕寫「只看欠繳」
   * 而做的是「逾期且未繳清」,**照它催繳會漏掉還沒到期的未繳**(驗收:逾期 9、
   * 未繳未逾期 8、未繳清共 17,而舊按鈕只給 9)。
   *
   * 三者是同一個母體的子集,對應催繳實務的三批:
   * 快到期→提醒、已逾期→催、全部未繳清→母體。**所以是三選一不是三個開關。**
   */
  protected readonly dueFilter = signal<'all' | 'outstanding' | 'overdue' | 'dueSoon'>('all');
  /**
   * 「快到期」的天數**讀後端**（`summary.dueSoon.days`），前端不另存一份 —— 判準只有一個來源
   * （`lib/invoice-overdue.ts` 的 `DUE_SOON_DAYS`）。彙總還沒回來時不寫數字。
   */
  protected readonly dueSoonLabel = computed(() => {
    const days = this.summary()?.dueSoon.days;
    return days === undefined ? '快到期' : `${days} 天內到期`;
  });
  protected readonly overdueOnly = computed(() => this.dueFilter() === 'overdue');

  /** 順序照催繳實務的緊迫度:全部 → 母體 → 快到期 → 已逾期 */
  protected readonly dueFilterOptions = [
    { label: '全部', value: 'all' },
    { label: '未繳清', value: 'outstanding' },
    { label: '快到期', value: 'dueSoon' },
    { label: '已逾期', value: 'overdue' },
  ];

  /** 空狀態要說清楚**是哪一個篩選**空了 —— 「沒有欠繳的帳單」對三個子集都成立,
   *  而它們空的意思完全不同(未繳清空=全收齊了;快到期空=這週沒有要收的) */
  protected readonly emptyStateTitle = computed(() => {
    switch (this.dueFilter()) {
      case 'outstanding':
        return '沒有未繳清的帳單';
      case 'dueSoon':
        return `沒有${this.dueSoonLabel()}的帳單`;
      case 'overdue':
        return '沒有逾期的帳單';
      default:
        return '沒有帳單';
    }
  });

  protected readonly emptyStateDescription = computed(() => {
    switch (this.dueFilter()) {
      case 'outstanding':
        return '所有已開立的帳單都收齊了';
      case 'dueSoon':
        return `目前沒有${this.dueSoonLabel()}又還沒繳清的帳單`;
      case 'overdue':
        return '目前沒有過期又還沒繳清的帳單';
      default:
        return '';
    }
  });
  /**
   * 搜尋框（學生名、家長名、帳單編號；後端 `search`）。節流 + 去重之後才進 `load()`。
   * 取代原本的學生自動完成：它只能選學生，搜不到家長與帳單編號。
   */
  protected readonly searchQuery = signal('');
  private readonly searchInput = new Subject<string>();
  /**
   * **所有**取數都經過這裡再 `switchMap`：搜尋是逐字打的，慢的那支後到會蓋掉新的結果，
   * 而畫面上輸入框顯示的是最新的字（見 students.page 的同款說明）。
   */
  private readonly loadRequests = new Subject<void>();
  protected readonly pageIndex = signal(1);
  protected readonly totalRecords = signal(0);
  protected readonly statusFilter = signal<InvoiceStatus | null>(null);

  /**
   * **不要寫成 `format(new Date(), 'yyyy-MM-dd')`。** 那是瀏覽器本地日期，而
   * `overdue=true` 的**篩選**是伺服器用台北日期做的 —— 管理員的機器不在
   * `Asia/Taipei`、時間又落在台北凌晨的話，伺服器把某張帳單當逾期撈進清單，
   * 而那一列的逾期標記不會亮（#467）。
   *
   * `isOverdue()` 自己是對的（它的檔頭甚至專門解釋了為什麼不轉 `Date`），
   * **時區是從它的參數走進來的** —— 函式擋得住呼叫端傳錯型別，擋不住呼叫端
   * 傳一個算錯的值。
   */
  private readonly systemClock = inject(SystemClockService);
  protected readonly today = this.systemClock.todayTaipei;

  /**
   * 匯出（A6 匯出面板）：月份預設**今天所在的台北月**，範圍三選一。
   * **匯出範圍不跟畫面上的篩選走**——面板上寫什麼就匯什麼，避免「畫面是逾期、檔案是全部」的落差。
   */
  protected readonly exportMonth = signal(this.systemClock.todayTaipei().slice(0, 7));
  protected readonly exportScope = signal<ExportScope>('all');
  protected readonly exporting = signal(false);
  protected readonly exportScopeOptions = (Object.keys(EXPORT_SCOPE_LABELS) as ExportScope[]).map(
    (value) => ({ value, label: EXPORT_SCOPE_LABELS[value] }),
  );

  /** 工具列「⋯」：現況有、A6 沒畫的次要動作收在這裡 */
  protected readonly pageMenuItems: MenuItem[] = [
    { label: '操作紀錄', icon: 'pi pi-history', command: () => this.openAuditLog() },
  ];

  /**
   * 已經生效、但從來沒開過帳單的報名數。
   *
   * **這是 B3「決定 4」（報名與帳單不同事務）的可見性那一半** —— 開帳失敗時報名保留，
   * 而那個決定成立的前提是殘留看得見。沒有這個數字，「報名在、帳單不在」
   * 就只是一個沒人查得到的狀態。
   *
   * 取的是 `meta.total`（篩後全體）不是 `data.length`（當頁）—— charter 坑 #4。
   * 載入失敗就當 0，**不擋主列表**：它是提醒不是前提。
   */
  protected readonly uninvoicedCount = signal(0);

  protected readonly statusOptions = [
    { value: null, label: '全部狀態' },
    ...(Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map((value) => ({
      value,
      label: INVOICE_STATUS_LABELS[value],
    })),
  ];

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.pageIndex() - 1) * PAGE_SIZE, 0),
    rows: PAGE_SIZE,
    totalRecords: this.totalRecords(),
  }));

  /** 手機的「篩選：全部」面板開合與摘要（#1314 ③）：學生搜尋框之外是狀態與催繳兩項 */
  protected readonly filtersOpen = signal(false);
  protected readonly panelFilterSummary = computed(() => {
    const parts: string[] = [];
    const due = this.dueFilterOptions.find((o) => o.value === this.dueFilter());
    if (this.dueFilter() !== 'all' && due) parts.push(due.label);
    const status = this.statusFilter();
    if (status !== null) parts.push(INVOICE_STATUS_LABELS[status]);
    return parts.length > 0 ? parts.join('、') : '全部';
  });

  protected readonly hasFilters = computed(
    () => this.dueFilter() !== 'all' || this.statusFilter() !== null || this.searchQuery() !== '',
  );

  /**
   * 帳本彙總（#1314 P1／P2）。**金額與張數全由後端加總**，這裡只顯示；
   * 失敗就當沒有 —— 色面退回頁名、章名不帶數字，不擋主列表。
   */
  protected readonly summary = signal<InvoiceSummary | null>(null);

  /**
   * 沒有任何篩選時是 A6 的「章」：逾期章（攤開）＋已繳清章（收著）。
   * 一動舊的篩選（學生、狀態、催繳三選一）就回到原本那張平面表 —— 暫留，
   * 等「7 天內到期」「還沒到期」兩章接上（#1314 P1 第二支）才退場。
   */
  protected readonly chapterMode = computed(() => !this.hasFilters());

  /** 手機托盤（A6）：只有「開立帳單」。「全部提醒」連同催繳紀錄在 #1625 拿掉 —— 聯絡家長改在帳單詳情 */
  protected readonly primaryAction: PageAction = { label: '開立帳單', icon: 'pi pi-plus' };

  protected readonly monthLabel = computed(() => {
    const month = this.summary()?.month.month;
    return month ? `${Number(month.slice(5, 7))} 月` : '';
  });
  /** 已收幾成。**唯一的前端除法**；本月沒開單（billed=0）不除 */
  protected readonly receivedPct = computed(() => {
    const month = this.summary()?.month;
    if (!month || month.billed <= 0) return null;
    return Math.round((month.received / month.billed) * 100);
  });
  /** 色面那句話。`line2` 只在本月有開單時才有（billed=0 不報百分比） */
  protected readonly bandTitle = computed(() => {
    const month = this.summary()?.month;
    if (!month) return null;
    const pct = this.receivedPct();
    return {
      line1: `${this.monthLabel()}應收 NT$ ${month.billed.toLocaleString('en-US')}${pct === null ? '。' : '，'}`,
      line2: pct === null ? '' : `已收 ${pct}%。`,
    };
  });
  /** 還差多少。**唯一的前端減法**；已收超過應收時夾成 0（不顯示「還差負的」） */
  protected readonly stillOwed = computed(() => {
    const month = this.summary()?.month;
    return month ? Math.max(0, month.billed - month.received) : 0;
  });
  /**
   * 收著的三章（A6：逾期攤開，其餘摘要列、展開才抓）。三章共用一組狀態與載入函式，
   * 不寫三份；各章展開、分頁彼此獨立。
   */
  protected readonly chapters = signal<Record<ChapterKey, ChapterState>>({
    dueSoon: emptyChapter(),
    notDue: emptyChapter(),
    paid: emptyChapter(),
  });

  /** 畫面上的章，順序照 A6：7 天內到期 → 還沒到期 → 已繳清。沒有彙總或張數為 0 的章不畫 */
  protected readonly chapterList = computed(() => {
    const s = this.summary();
    if (!s) return [];
    const state = this.chapters();
    return [
      {
        key: 'dueSoon' as const,
        title: this.dueSoonLabel(),
        count: s.dueSoon.count,
        outstanding: s.dueSoon.outstanding as number | null,
        received: null as number | null,
        state: state.dueSoon,
      },
      {
        key: 'notDue' as const,
        title: '未到期',
        count: s.notDue.count,
        outstanding: s.notDue.outstanding as number | null,
        received: null as number | null,
        state: state.notDue,
      },
      {
        key: 'paid' as const,
        title: '已繳清',
        // 繳清＋多退（整數相加，不是金額）
        count: s.byStatus.paid.count + s.byStatus.overrefunded.count,
        outstanding: null,
        // 「收到 NT$」＝繳清帳單的淨收（後端加總）；其餘兩章是「待收」
        received: s.byStatus.paid.received as number | null,
        state: state.paid,
      },
    ].filter((chapter) => chapter.count > 0);
  });
  protected readonly PAGE_SIZE = PAGE_SIZE;

  /**
   * #1732：畫面上出現的學生 → 未處理的連續請假天數（帳單頁名字旁的「連請 N 天」小標）。
   * 讀取時現算、只回有沒有＋天數，明細在學生檔案。失敗就不畫（提醒，不擋帳單頁）。
   */
  protected readonly streakDays = signal<ReadonlyMap<string, number>>(new Map());
  private readonly leaveStreaksService = inject(LeaveStreaksService);
  private readonly visibleStudentIds = computed(() => {
    const ids = new Set(this.invoices().map((i) => i.studentId));
    for (const key of CHAPTER_KEYS) for (const i of this.chapters()[key].rows) ids.add(i.studentId);
    return [...ids].sort().join(',');
  });

  constructor() {
    toObservable(this.visibleStudentIds)
      .pipe(
        debounceTime(50),
        distinctUntilChanged(),
        switchMap((joined) => {
          const ids = joined ? joined.split(',') : [];
          // API 一次最多 100 個
          const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, n) =>
            this.leaveStreaksService.flags(ids.slice(n * 100, n * 100 + 100)),
          );
          return batches.length === 0
            ? of([])
            : forkJoin(batches).pipe(
                map((all) => all.flatMap((res) => res.data)),
                catchError(() => of([])),
              );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((flags) => {
        const days = new Map<string, number>();
        for (const f of flags) days.set(f.studentId, Math.max(days.get(f.studentId) ?? 0, f.days));
        this.streakDays.set(days);
      });

    this.campusCtx.use();
    // 初次載入由 ngOnInit 做；這裡只管之後頂欄換分校：頁碼歸 1、列表／摘要／展開的章／待開帳數全部重抓
    toObservable(this.campusCtx.id)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.pageIndex.set(1);
        for (const key of CHAPTER_KEYS) this.patchChapter(key, { page: 1 });
        this.refreshAll();
        this.loadUninvoicedCount();
      });
  }

  ngOnInit(): void {
    this.setupLoadPipeline();
    this.searchInput
      .pipe(
        debounceTime(300),
        // 對照目前生效的查詢（不是上一次輸入）：清除篩選會直接清掉 searchQuery，之後再打同一個字要送得出去
        filter((value) => value !== this.searchQuery()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.reload();
      });
    const due = this.due();
    if (due === 'overdue' || due === 'outstanding' || due === 'dueSoon') this.dueFilter.set(due);
    this.load();
    this.loadSummary();
    this.loadUninvoicedCount();
  }

  /**
   * 摘要／各章／待開帳數都走 `switchMap`：頂欄快切分校時，慢的舊分校回應不能蓋掉新的
   * （畫面上頂欄顯示的是最新的分校，數字卻是上一間的，是最糟的騙法）。
   */
  private readonly summaryRequests = new Subject<void>();
  private readonly uninvoicedRequests = new Subject<void>();
  private readonly chapterRequests: Record<ChapterKey, Subject<void>> = {
    dueSoon: new Subject<void>(),
    notDue: new Subject<void>(),
    paid: new Subject<void>(),
  };

  private loadSummary(): void {
    this.summaryRequests.next();
  }

  private patchChapter(key: ChapterKey, patch: Partial<ChapterState>): void {
    this.chapters.update((all) => ({ ...all, [key]: { ...all[key], ...patch } }));
  }

  /**
   * `<details name>` 的 toggle（#1705）：使用者點開、或瀏覽器因為同組互斥把它收起來，都走這裡。
   * 跟狀態一樣就不動 —— `[open]` 綁定自己寫回去的那一次也會發 toggle，不能因此重抓。
   */
  protected onChapterToggle(key: ChapterKey, open: boolean): void {
    if (this.chapters()[key].open === open) return;
    this.patchChapter(key, { open });
    if (open) this.loadChapter(key);
  }

  /** 逾期章的分頁（章節模式下 `invoices()` 就是逾期那張清單） */
  protected onChapterPage(event: PaginatorState): void {
    this.pageIndex.set(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
    this.load();
  }

  protected onChapterPageOf(key: ChapterKey, event: PaginatorState): void {
    this.patchChapter(key, { page: Math.floor((event.first ?? 0) / PAGE_SIZE) + 1 });
    this.loadChapter(key);
  }

  protected chapterFirst(state: ChapterState): number {
    return (state.page - 1) * PAGE_SIZE;
  }

  /**
   * 某一章展開後的列。到期兩章是 `dueState`（後端互斥章篩選）；已繳清章第 1 頁前面接全部多退
   * （通常寥寥幾張、`pageSize` 取上限）、後面才是繳清的分頁，分頁器只數繳清的 ——
   * 列表一次只收一個 `status`，所以是兩支請求。多退只在第 1 頁出現，翻頁不重複。
   */
  /** `rows`：帳本變動後的重抓，那一列淡入、淡出或就地更新（#1641 5b）；展開、換頁不帶 */
  protected loadChapter(key: ChapterKey, { rows = false }: { rows?: boolean } = {}): void {
    if (rows) this.chapterReloadRows.add(key);
    else this.chapterReloadRows.delete(key);
    this.patchChapter(key, { loading: true, failed: false });
    this.chapterRequests[key].next();
  }

  private chapterRequest(key: ChapterKey) {
    const page = this.chapters()[key].page;
    const campusId = this.campusId();
    return key === 'paid'
      ? forkJoin([
          this.service.list({ status: 'paid', campusId, page, pageSize: PAGE_SIZE }),
          page === 1 && (this.summary()?.byStatus.overrefunded.count ?? 1) > 0
            ? this.service.list({ status: 'overrefunded', campusId, page: 1, pageSize: 200 })
            : of(null),
        ])
      : forkJoin([
          this.service.list({ dueState: key, campusId, page, pageSize: PAGE_SIZE }),
          of(null),
        ]);
  }

  /** 姓名旁的年級（A6「林沛晴 · 國三」）。API 沒給或不認得就不顯示，不顯示原始代碼 */
  protected gradeLabel(grade: string | null | undefined): string | null {
    return grade ? (GRADE_LEVEL_LABELS[grade as GradeLevel] ?? null) : null;
  }

  /** 章裡每列的「到期」那一欄文字 */
  protected dueText(invoice: Invoice): string {
    if (invoice.status === 'overrefunded') return '多退';
    if (invoice.status === 'paid') {
      const on = lastPaidOn(invoice);
      return on ? `${on} 繳清` : '已繳清';
    }
    const late = daysOverdue(invoice, this.today());
    if (late > 0) return `逾期 ${late} 天`;
    if (!invoice.dueDate) return '未設定到期日';
    const left = daysUntilDue(invoice, this.today());
    const soon = this.summary()?.dueSoon.days;
    if (soon !== undefined && left <= soon) return left === 0 ? '今天到期' : `${left} 天後到期`;
    return `${+invoice.dueDate.slice(5, 7)}/${+invoice.dueDate.slice(8, 10)} 到期`;
  }

  /** 章裡每列右邊的金額：待收／繳清是帳單金額，多退是退多少 */
  protected chapterAmount(invoice: Invoice): number {
    if (invoice.status === 'overrefunded') return overRefunded(invoice);
    if (invoice.status === 'paid') return invoice.total;
    return outstanding(invoice);
  }

  /** 做了任何會改變帳本的事之後：列表、彙總、（展開中的）已繳清章都要重抓 */
  private refreshAll(): void {
    this.load({ rows: true });
    this.loadSummary();
    this.reloadOpenChapters({ rows: true });
  }

  private reloadOpenChapters(options: { rows?: boolean } = {}): void {
    for (const key of CHAPTER_KEYS) {
      if (this.chapters()[key].open) this.loadChapter(key, options);
    }
  }

  private loadUninvoicedCount(): void {
    this.uninvoicedRequests.next();
  }

  protected openUninvoiced(): void {
    const ref = this.dialogService.open(UninvoicedDialogComponent, {
      width: '640px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });

    ref?.onClose.subscribe((result: { issued: number } | undefined) => {
      if (!result) return;
      // 開了帳單 → 帳單列表與待開帳數字都變了
      this.refreshAll();
      this.loadUninvoicedCount();
      this.messageService.add({
        severity: 'success',
        summary: '已開帳',
        detail: `開了 ${result.issued} 張帳單`,
      });
    });
  }

  protected async exportInvoices(popover: Popover): Promise<void> {
    const month = this.exportMonth();
    if (this.exporting() || !/^\d{4}-\d{2}$/.test(month)) return;
    this.exporting.set(true);
    try {
      const scope = this.exportScope();
      const rows: Invoice[] = [];
      // 一頁最多 200 筆；用 meta.total 判斷收完了沒
      for (let page = 1; ; page++) {
        const res = await firstValueFrom(
          this.service.list({
            issuedMonth: month,
            overdue: scope === 'overdue' || undefined,
            outstanding: scope === 'outstanding' || undefined,
            campusId: this.campusId(),
            page,
            pageSize: 200,
          }),
        );
        rows.push(...res.data);
        if (res.data.length === 0 || rows.length >= res.meta.total) break;
      }
      if (rows.length === 0) {
        this.messageService.add({
          severity: 'info',
          summary: '沒有可匯出的帳單',
          detail: `${month} 沒有符合的帳單`,
        });
        return;
      }
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(
        rows.map((row) => invoiceExportRow(row, this.today())),
      );
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '帳單');
      const suffix = scope === 'all' ? '' : `_${EXPORT_SCOPE_LABELS[scope]}`;
      XLSX.writeFile(book, `帳單_${month}${suffix}.xlsx`);
      popover.hide();
      this.messageService.add({
        severity: 'success',
        summary: '已匯出',
        detail: `${rows.length} 張帳單（Excel）`,
      });
    } catch (err) {
      // 舊分頁要不到 xlsx 的 chunk（#1718）：亮新版提示條，不說「匯出失敗、請稍後再試」（再試也一樣）
      if (this.version.recoverFromImportFailure(err)) return;
      this.messageService.add({ severity: 'error', summary: '匯出失敗', detail: '請稍後再試' });
    } finally {
      this.exporting.set(false);
    }
  }

  protected openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        resourceTypes: ['invoice', 'payment_record'],
      },
    });
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  /** `rows`：帳本變動後的重抓，那一列淡入、淡出或就地更新（#1641 5b）；篩選、換頁不帶 */
  protected load({ rows = false }: { rows?: boolean } = {}): void {
    this.reloadRows = rows;
    this.loading.set(true);
    this.failed.set(false);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.summaryRequests
      .pipe(
        switchMap(() =>
          this.service.summary({ campusId: this.campusId() }).pipe(
            catchError(() => {
              this.summary.set(null);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.summary.set(res));

    this.uninvoicedRequests
      .pipe(
        switchMap(() =>
          this.enrollmentsService
            .list({ hasInvoice: false, status: 'active', campusId: this.campusId(), pageSize: 1 })
            .pipe(
              catchError(() => {
                this.uninvoicedCount.set(0);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => this.uninvoicedCount.set(res.meta.total));

    for (const key of CHAPTER_KEYS) {
      this.chapterRequests[key]
        .pipe(
          switchMap(() =>
            this.chapterRequest(key).pipe(
              catchError(() => {
                this.patchChapter(key, { rows: [], failed: true, loading: false });
                return EMPTY;
              }),
            ),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(([main, over]) => {
          const apply = () =>
            this.patchChapter(key, {
              rows: [...(over?.data ?? []), ...main.data],
              total: main.meta.total,
              loading: false,
            });
          const reloadRows = this.chapterReloadRows.delete(key);
          // 沒有舊內容（第一次、或上次失敗）：骨架換列表，高度由 appHeightFollow 滑開，不需要 VT 換場（#1853）
          if (this.chapters()[key].rows.length === 0) apply();
          // 舊內容（變淡中）平滑換成新資料（#1641 5b）
          else this.viewTransition(apply, { rows: reloadRows });
        });
    }

    this.loadRequests
      .pipe(
        switchMap(() =>
          this.service
            .list({
              search: this.searchQuery() || undefined,
              outstanding: this.dueFilter() === 'outstanding' || undefined,
              // 章節模式下這張表就是逾期章
              overdue: this.dueFilter() === 'overdue' || this.chapterMode() || undefined,
              // 同一個閉區間，判準在後端 `dueStateOn`；前端不再帶天數
              dueState: this.dueFilter() === 'dueSoon' ? 'dueSoon' : undefined,
              status: this.statusFilter() ?? undefined,
              campusId: this.campusId(),
              page: this.pageIndex(),
              pageSize: PAGE_SIZE,
            })
            // catchError 必須在內層：外層的 error 會終止整條管線，一次失敗就讓這頁再也載不了
            .pipe(
              catchError(() => {
                this.invoices.set([]);
                this.totalRecords.set(0);
                this.failed.set(true);
                this.loading.set(false);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        // 舊內容（變淡中）平滑換成新資料（#1641 5b）
        this.viewTransition(
          () => {
            this.invoices.set(res.data);
            this.totalRecords.set(res.meta.total);
            this.loading.set(false);
          },
          { rows: this.reloadRows },
        );
        this.reloadRows = false;
      });
  }

  /** 任何篩選變動都要回到第 1 頁 —— 留在第 3 頁換條件會看到空白而不是結果 */
  private reload(): void {
    this.pageIndex.set(1);
    this.load();
  }

  protected setDueFilter(value: 'all' | 'outstanding' | 'overdue' | 'dueSoon'): void {
    this.dueFilter.set(value);
    this.reload();
  }

  /** 狀態一律打後端 —— 它是推導值，前端篩只篩得到當頁 */
  protected onStatusChange(value: InvoiceStatus | null): void {
    this.statusFilter.set(value);
    this.reload();
  }

  protected onSearchChange(value: string): void {
    this.searchInput.next(value.trim());
  }

  protected clearFilters(): void {
    this.dueFilter.set('all');
    this.statusFilter.set(null);
    this.searchQuery.set('');
    this.reload();
  }

  protected onPageChange(event: ResponsiveTablePageEvent): void {
    this.pageIndex.set(Math.floor(event.first / PAGE_SIZE) + 1);
    this.load();
  }

  protected isOverdue(invoice: Invoice): boolean {
    return isOverdue(invoice, this.today());
  }

  protected outstanding(invoice: Invoice): number {
    return outstanding(invoice);
  }

  protected overRefunded(invoice: Invoice): number {
    return overRefunded(invoice);
  }

  /**
   * **逾期不是第四種狀態**（billing-rules 規則 7）—— 它是 `due_date` 的衍生標記，
   * 所以這裡只看 status，逾期由旁邊那顆獨立的標記承擔。
   *
   * 這樣「部分繳 + 逾期」才表達得出來：狀態說「部分繳」（還在等），
   * 旁邊的「逾期」說該處理了。把兩者塞進一個 tone 會少掉一半資訊。
   */
  protected statusTone(invoice: Invoice): StatusTone {
    // 作廢單用既有的 inactive —— 它不在等錢，也不是繳清（#898）
    if (invoice.status === 'void') return 'inactive';
    // 多退（#1034）不是繳清：要處理（追回或另開帳單）
    return invoice.status === 'paid' ? 'done' : 'pending';
  }

  /** 列上「收款」：直接開收款表單（不必先開帳單詳情）。收完整頁重抓 */
  protected collect(invoice: Invoice): void {
    const ref = this.dialogService.open(PaymentFormDialogComponent, {
      header: '記錄收款',
      width: '440px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { invoice, kind: 'payment' },
    });
    ref?.onClose.subscribe((updated: Invoice | undefined) => {
      if (updated) this.refreshAll();
    });
  }

  protected openDetail(invoice: Invoice): void {
    const ref = this.dialogService.open(InvoiceDetailDialogComponent, {
      width: '720px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { invoice },
    });

    ref?.onClose.subscribe((updated: Invoice | undefined) => {
      // 只有真的動過才重新取數 —— 純瀏覽關掉不該讓整張表閃一次
      if (updated) this.refreshAll();
    });
  }

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(InvoiceFormDialogComponent, {
      width: '640px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });

    ref?.onClose.subscribe((created: Invoice | undefined) => {
      if (!created) return;
      this.reload();
      this.loadSummary();
      this.reloadOpenChapters();
      // 開完帳最常見的下一步就是收錢（新生報名當場繳定金）。原本要關掉這個 dialog、
      // 回列表、再把剛開的那張找出來點進去 —— 三個動作換一件本來就連著的事。
      this.openDetail(created);
    });
  }
}
