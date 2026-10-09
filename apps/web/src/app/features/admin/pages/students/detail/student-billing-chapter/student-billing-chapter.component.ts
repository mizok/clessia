import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';

import {
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  InvoicesService,
  isOpenInvoice,
  type Invoice,
} from '@core/invoices.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SystemClockService } from '@core/system-clock.service';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

import { InvoiceDetailDialogComponent } from '../../../payments/invoice-detail-dialog/invoice-detail-dialog.component';
import { daysOverdue, isOverdue, outstanding } from '../../../payments/payments.util';

/**
 * 學生檔案的帳單章（#1314 P3 的前提）：摘要列收著，展開看每張帳單。
 *
 * **作廢與列印收費單在這裡**（使用者 10-08 裁留）：按鈕開既有的帳單詳情 dialog，
 * 作廢表單與列印都在 dialog 裡 —— 不複製第二份。
 *
 * 摘要列的「待繳」讀 API（`GET /invoices/summary?studentId=`），前端不加總金額。
 * 帳單一次抓 200 張（單一學生遠低於此）；ponytail: 超過就不顯示後面的，要的話再做分頁。
 */
@Component({
  selector: 'app-student-billing-chapter',
  standalone: true,
  imports: [DecimalPipe, RouterLink, StatusDotComponent, ToastModule],
  // 帳單詳情 dialog 要 MessageService（作廢、收款、催繳的結果訊息）；這頁原本沒有，所以章自己帶一組＋下面的 p-toast
  providers: [MessageService, DialogService],
  templateUrl: './student-billing-chapter.component.html',
})
export class StudentBillingChapterComponent implements OnInit {
  readonly studentId = input.required<string>();

  private readonly invoicesService = inject(InvoicesService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly clock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly invoices = signal<Invoice[]>([]);
  /** null＝還沒回來或失敗；失敗時摘要列只寫「帳單」不騙人說沒有待繳 */
  protected readonly totalOutstanding = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly allInvoicesLink = RoutesCatalog.ADMIN_PAYMENTS.absolutePath;
  protected readonly INVOICE_STATUS_LABELS = INVOICE_STATUS_LABELS;
  protected readonly outstanding = outstanding;

  private readonly today = this.clock.todayTaipei;

  /** 摘要列右邊那句：最該處理的一張（逾期優先、其次最早到期） */
  protected readonly dueNote = computed(() => {
    const today = this.today();
    const open = this.invoices().filter((i) => isOpenInvoice(i.status) && i.dueDate !== null);
    const overdue = open.filter((i) => isOverdue(i, today));
    if (overdue.length > 0) {
      const days = Math.max(...overdue.map((i) => daysOverdue(i, today)));
      return `逾期 ${days} 天`;
    }
    const next = open.map((i) => i.dueDate!).sort()[0];
    return next ? `${Number(next.slice(5, 7))}/${Number(next.slice(8, 10))} 到期` : '';
  });

  protected readonly hasOverdue = computed(() => {
    const today = this.today();
    return this.invoices().some((i) => isOverdue(i, today));
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    const studentId = this.studentId();
    this.loading.set(true);
    this.failed.set(false);
    this.invoicesService
      .list({ studentId, pageSize: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.invoices.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
    this.invoicesService
      .summary({ studentId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.totalOutstanding.set(s.outstanding ?? null),
        error: () => this.totalOutstanding.set(null),
      });
  }

  protected isOverdue(invoice: Invoice): boolean {
    return isOverdue(invoice, this.today());
  }

  protected itemLabel(item: Invoice['items'][number]): string {
    const base = INVOICE_ITEM_TYPE_LABELS[item.type];
    return item.note ? `${base}（${item.note}）` : base;
  }

  protected openDetail(invoice: Invoice): void {
    const ref = this.dialogService.open(InvoiceDetailDialogComponent, {
      width: '720px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainerService.getContainer() || 'body',
      data: { invoice },
    });
    // 只有真的動過（作廢、收款、催繳）才重抓
    ref?.onClose.subscribe((updated: Invoice | undefined) => {
      if (updated) this.load();
    });
  }
}
