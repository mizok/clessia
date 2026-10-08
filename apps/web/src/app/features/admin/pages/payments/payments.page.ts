import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
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
import { StudentsService, type Student } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { SystemClockService } from '@core/system-clock.service';

import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { InvoiceDetailDialogComponent } from './invoice-detail-dialog/invoice-detail-dialog.component';
import { InvoiceFormDialogComponent } from './invoice-form-dialog/invoice-form-dialog.component';
import { UninvoicedDialogComponent } from './uninvoiced-dialog/uninvoiced-dialog.component';
import { daysOverdue, isOverdue, lastPaidOn, outstanding, overRefunded } from './payments.util';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';
import { TodoBannerComponent } from '@shared/components/todo-banner/todo-banner.component';

const PAGE_SIZE = LIST_PAGE_SIZE;

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
    StatusDotComponent,
    DecimalPipe,
    FormsModule,
    ButtonModule,
    SelectModule,
    SelectButtonModule,
    PaginatorModule,
    ToastModule,
    PageActionsComponent,
    PageOpenComponent,
    EmptyStateComponent,
    StudentAutocompleteComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
    TodoBannerComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './payments.page.html',
})
export class PaymentsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly service = inject(InvoicesService);
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly INVOICE_STATUS_LABELS = INVOICE_STATUS_LABELS;
  protected readonly primaryAction: PageAction = { label: '手動開帳', icon: 'pi pi-plus' };

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
  /** 「快到期」的天數。7 天是催繳實務的一週節奏,不是隨便挑的 */
  protected readonly DUE_SOON_DAYS = 7;
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
        return `${this.DUE_SOON_DAYS} 天內沒有要到期的帳單`;
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
        return `目前沒有 ${this.DUE_SOON_DAYS} 天內到期又還沒繳清的帳單`;
      case 'overdue':
        return '目前沒有過期又還沒繳清的帳單';
      default:
        return '';
    }
  });
  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
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

  protected readonly hasFilters = computed(
    () =>
      this.dueFilter() !== 'all' || this.statusFilter() !== null || this.selectedStudent() !== null,
  );

  protected readonly selectedStudent = computed(() => {
    const value = this.student();
    return typeof value === 'string' || value === null ? null : value;
  });

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
  /** 已繳清章張數：繳清＋多退（整數相加，不是金額） */
  protected readonly paidChapterCount = computed(() => {
    const by = this.summary()?.byStatus;
    return by ? by.paid.count + by.overrefunded.count : 0;
  });

  // 已繳清章：收著，展開才抓。多退併進這一章（先列，因為要處理）
  protected readonly paidOpen = signal(false);
  protected readonly paidLoading = signal(false);
  protected readonly paidFailed = signal(false);
  protected readonly paidRows = signal<Invoice[]>([]);
  protected readonly paidTotal = signal(0);
  protected readonly paidPageIndex = signal(1);
  protected readonly paidFirst = computed(() => (this.paidPageIndex() - 1) * PAGE_SIZE);
  protected readonly PAGE_SIZE = PAGE_SIZE;

  ngOnInit(): void {
    this.load();
    this.loadSummary();
    this.loadUninvoicedCount();
  }

  private loadSummary(): void {
    this.service.summary().subscribe({
      next: (res) => this.summary.set(res),
      error: () => this.summary.set(null),
    });
  }

  protected togglePaid(): void {
    this.paidOpen.update((open) => !open);
    if (this.paidOpen()) this.loadPaid();
  }

  /** 逾期章的分頁（章節模式下 `invoices()` 就是逾期那張清單） */
  protected onChapterPage(event: PaginatorState): void {
    this.pageIndex.set(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
    this.load();
  }

  protected onPaidPage(event: PaginatorState): void {
    this.paidPageIndex.set(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
    this.loadPaid();
  }

  /**
   * 已繳清章的列：第 1 頁前面接全部多退（通常寥寥幾張、`pageSize` 取上限），
   * 後面才是繳清的分頁；分頁器只數繳清的。多退只在第 1 頁出現，翻頁不重複。
   */
  protected loadPaid(): void {
    this.paidLoading.set(true);
    this.paidFailed.set(false);
    const page = this.paidPageIndex();
    forkJoin([
      this.service.list({ status: 'paid', page, pageSize: PAGE_SIZE }),
      page === 1 && (this.summary()?.byStatus.overrefunded.count ?? 1) > 0
        ? this.service.list({ status: 'overrefunded', page: 1, pageSize: 200 })
        : of(null),
    ]).subscribe({
      next: ([paid, over]) => {
        this.paidRows.set([...(over?.data ?? []), ...paid.data]);
        this.paidTotal.set(paid.meta.total);
        this.paidLoading.set(false);
      },
      error: () => {
        this.paidRows.set([]);
        this.paidFailed.set(true);
        this.paidLoading.set(false);
      },
    });
  }

  /** 章裡每列的「到期」那一欄文字 */
  protected dueText(invoice: Invoice): string {
    if (invoice.status === 'overrefunded') return '多退';
    if (invoice.status === 'paid') {
      const on = lastPaidOn(invoice);
      return on ? `${on} 繳清` : '已繳清';
    }
    const days = daysOverdue(invoice, this.today());
    return days > 0 ? `逾期 ${days} 天` : '';
  }

  /** 章裡每列右邊的金額：待收／繳清是帳單金額，多退是退多少 */
  protected chapterAmount(invoice: Invoice): number {
    if (invoice.status === 'overrefunded') return overRefunded(invoice);
    if (invoice.status === 'paid') return invoice.total;
    return outstanding(invoice);
  }

  /** 做了任何會改變帳本的事之後：列表、彙總、（展開中的）已繳清章都要重抓 */
  private refreshAll(): void {
    this.load();
    this.loadSummary();
    if (this.paidOpen()) this.loadPaid();
  }

  private loadUninvoicedCount(): void {
    this.enrollmentsService.list({ hasInvoice: false, status: 'active', pageSize: 1 }).subscribe({
      next: (res) => this.uninvoicedCount.set(res.meta.total),
      error: () => this.uninvoicedCount.set(0),
    });
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

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.service
      .list({
        studentId: this.selectedStudent()?.id,
        outstanding: this.dueFilter() === 'outstanding' || undefined,
        // 章節模式下這張表就是逾期章
        overdue: this.dueFilter() === 'overdue' || this.chapterMode() || undefined,
        dueWithin: this.dueFilter() === 'dueSoon' ? this.DUE_SOON_DAYS : undefined,
        status: this.statusFilter() ?? undefined,
        page: this.pageIndex(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.invoices.set(res.data);
          this.totalRecords.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.invoices.set([]);
          this.totalRecords.set(0);
          this.failed.set(true);
          this.loading.set(false);
        },
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

  protected onStudentChange(value: Student | string | null): void {
    this.student.set(value);
    // 打字中間會是字串，那還不是一個選定的學生，不要每個字都打一次 API
    if (typeof value !== 'string') this.reload();
  }

  protected onStudentQuery(query: string): void {
    if (!query.trim()) {
      this.studentSuggestions.set([]);
      return;
    }

    this.studentsService
      .list({ search: query, searchScope: 'student_name', pageSize: 20 })
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data),
        error: () => this.studentSuggestions.set([]),
      });
  }

  protected clearFilters(): void {
    this.dueFilter.set('all');
    this.statusFilter.set(null);
    this.student.set(null);
    this.studentSuggestions.set([]);
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
      if (this.paidOpen()) this.loadPaid();
      // 開完帳最常見的下一步就是收錢（新生報名當場繳定金）。原本要關掉這個 dialog、
      // 回列表、再把剛開的那張找出來點進去 —— 三個動作換一件本來就連著的事。
      this.openDetail(created);
    });
  }
}
