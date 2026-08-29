import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { OverlayContainerService } from '@core/overlay-container.service';
import { INVOICE_STATUS_LABELS, InvoicesService, type Invoice } from '@core/invoices.service';
import { StudentsService, type Student } from '@core/students.service';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';

import { InvoiceDetailDialogComponent } from './invoice-detail-dialog/invoice-detail-dialog.component';
import { InvoiceFormDialogComponent } from './invoice-form-dialog/invoice-form-dialog.component';
import { isOverdue, outstanding } from './payments.util';

const PAGE_SIZE = 20;

/**
 * 繳費紀錄 —— 見 kb/wiki/specs/admin/finance/payments.md 與
 * kb/wiki/architecture/admin-payments-page.md。
 *
 * **篩選只有兩項，那是刻意的。** `GET /api/invoices` 的 query 只吃 `studentId`、
 * `overdue`、`page`、`pageSize`。狀態是推導值 DB 濾不掉，在前端自己篩只會篩到
 * 當頁那 20 筆 —— 使用者看到「未繳 3 筆」而真相是 47 筆。要完整的狀態篩選得先有
 * 後端的 `status` 參數（已回報）。狀態改用每列的 Tag 呈現，行政真正需要的
 * 追繳清單走 `overdue=true`。
 *
 * **分頁不顯示總筆數。** 後端非 overdue 路徑的 `meta.total` 目前回的是當頁筆數
 * （`.range()` 之後才算 `rows.length`），拿它算總頁數會算出 1 頁。改用
 * 「當頁滿 pageSize 就還有下一頁」—— 少一個數字好過一個錯的數字。
 */
@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    TagModule,
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

  protected readonly today = format(new Date(), 'yyyy-MM-dd');

  /** 沒有可信的總數，只能從「這頁是不是滿的」推有沒有下一頁 */
  protected readonly hasNextPage = computed(() => this.invoices().length === PAGE_SIZE);
  protected readonly hasFilters = computed(
    () => this.overdueOnly() || this.selectedStudent() !== null,
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
        page: this.pageIndex(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.invoices.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.invoices.set([]);
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
    this.student.set(null);
    this.studentSuggestions.set([]);
    this.reload();
  }

  protected goToPage(delta: number): void {
    const next = this.pageIndex() + delta;
    if (next < 1) return;
    this.pageIndex.set(next);
    this.load();
  }

  protected isOverdue(invoice: Invoice): boolean {
    return isOverdue(invoice, this.today);
  }

  protected outstanding(invoice: Invoice): number {
    return outstanding(invoice);
  }

  protected statusSeverity(invoice: Invoice): 'success' | 'warn' | 'danger' {
    switch (invoice.status) {
      case 'paid':
        return 'success';
      case 'partial':
        return 'warn';
      default:
        return 'danger';
    }
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
      if (created) this.reload();
    });
  }
}
