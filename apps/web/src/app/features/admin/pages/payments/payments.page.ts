import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
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
} from '@core/invoices.service';
import { StudentsService, type Student } from '@core/students.service';

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

import { InvoiceDetailDialogComponent } from './invoice-detail-dialog/invoice-detail-dialog.component';
import { InvoiceFormDialogComponent } from './invoice-form-dialog/invoice-form-dialog.component';
import { isOverdue, outstanding } from './payments.util';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';

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
    ToastModule,
    EmptyStateComponent,
    StudentAutocompleteComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './payments.page.html',
  styleUrl: './payments.page.scss',
})
export class PaymentsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly service = inject(InvoicesService);
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly INVOICE_STATUS_LABELS = INVOICE_STATUS_LABELS;

  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly overdueOnly = signal(false);
  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly pageIndex = signal(1);
  protected readonly totalRecords = signal(0);
  protected readonly statusFilter = signal<InvoiceStatus | null>(null);

  protected readonly today = format(new Date(), 'yyyy-MM-dd');

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
    () => this.overdueOnly() || this.statusFilter() !== null || this.selectedStudent() !== null,
  );

  protected readonly selectedStudent = computed(() => {
    const value = this.student();
    return typeof value === 'string' || value === null ? null : value;
  });

  ngOnInit(): void {
    this.load();
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
        overdue: this.overdueOnly() || undefined,
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

  protected toggleOverdueOnly(): void {
    this.overdueOnly.update((v) => !v);
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
    this.overdueOnly.set(false);
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
    return isOverdue(invoice, this.today);
  }

  protected outstanding(invoice: Invoice): number {
    return outstanding(invoice);
  }

  /**
   * **逾期不是第四種狀態**（billing-rules 規則 7）—— 它是 `due_date` 的衍生標記，
   * 所以這裡只看 status，逾期由旁邊那顆獨立的標記承擔。
   *
   * 這樣「部分繳 + 逾期」才表達得出來：狀態說「部分繳」（還在等），
   * 旁邊的「逾期」說該處理了。把兩者塞進一個 tone 會少掉一半資訊。
   */
  protected statusTone(invoice: Invoice): StatusTone {
    return invoice.status === 'paid' ? 'done' : 'pending';
  }

  protected openDetail(invoice: Invoice): void {
    const ref = this.dialogService.open(InvoiceDetailDialogComponent, {
      header: '帳單詳情',
      width: '720px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { invoice },
    });

    ref?.onClose.subscribe((updated: Invoice | undefined) => {
      // 只有真的動過才重新取數 —— 純瀏覽關掉不該讓整張表閃一次
      if (updated) this.load();
    });
  }

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(InvoiceFormDialogComponent, {
      header: '開立帳單',
      width: '640px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });

    ref?.onClose.subscribe((created: Invoice | undefined) => {
      if (!created) return;
      this.reload();
      // 開完帳最常見的下一步就是收錢（新生報名當場繳定金）。原本要關掉這個 dialog、
      // 回列表、再把剛開的那張找出來點進去 —— 三個動作換一件本來就連著的事。
      this.openDetail(created);
    });
  }
}
