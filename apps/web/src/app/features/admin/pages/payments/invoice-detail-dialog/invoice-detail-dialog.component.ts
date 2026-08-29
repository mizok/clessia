import { Component, computed, inject, signal, viewChild, type ElementRef } from '@angular/core';
import { DecimalPipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { OverlayContainerService } from '@core/overlay-container.service';
import {
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  InvoicesService,
  PAYMENT_METHOD_LABELS,
  REMINDER_METHOD_LABELS,
  type Invoice,
  type PaymentKind,
  type PaymentReminder,
  type ReminderMethod,
} from '@core/invoices.service';

import { PaymentFormDialogComponent } from '../payment-form-dialog/payment-form-dialog.component';
import { isOverdue, outstanding, receiptNoOf } from '../payments.util';

/**
 * 帳單詳情：明細、收款記錄、催繳記錄，以及兩種列印。
 *
 * **為什麼是 dialog 不是獨立路由**：`routes-catalog` 沒有帳單詳情這條，而帳單永遠是
 * 從列表點進去的 —— 它不是會被 bookmark 或從選單進入的「家」。加一條路由就要同時動
 * catalog、`app.routes.ts`、`app.routes.spec.ts` 三個地方，換來一個沒有人會直接輸入的網址。
 *
 * **催繳的新增是頁內 inline 表單不是第三層 dialog**：只有兩個欄位（方式、備註），
 * 為它開一個疊在 dialog 上的 dialog 不划算，而且 modal 疊 modal 的焦點管理是額外的坑。
 *
 * 明細目前**唯讀** —— `POST/DELETE /{id}/items` 端點存在，但這一輪的工單沒有涵蓋
 * 「事後改明細」，沒有需求就不做按鈕。
 */
@Component({
  selector: 'app-invoice-detail-dialog',
  standalone: true,
  imports: [
    DecimalPipe,
    SlicePipe,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TooltipModule,
  ],
  templateUrl: './invoice-detail-dialog.component.html',
  styleUrl: './invoice-detail-dialog.component.scss',
})
export class InvoiceDetailDialogComponent {
  private readonly service = inject(InvoicesService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly INVOICE_ITEM_TYPE_LABELS = INVOICE_ITEM_TYPE_LABELS;
  protected readonly INVOICE_STATUS_LABELS = INVOICE_STATUS_LABELS;
  protected readonly PAYMENT_METHOD_LABELS = PAYMENT_METHOD_LABELS;
  protected readonly REMINDER_METHOD_LABELS = REMINDER_METHOD_LABELS;

  protected readonly invoice = signal<Invoice>(this.config.data.invoice);
  /** 有任何寫入就要讓列表重新取數，關閉時把最新的帳單帶回去 */
  private readonly dirty = signal(false);

  protected readonly today = format(new Date(), 'yyyy-MM-dd');

  protected readonly overdue = computed(() => isOverdue(this.invoice(), this.today));
  protected readonly outstandingAmount = computed(() => outstanding(this.invoice()));
  protected readonly receiptNo = computed(() => receiptNoOf(this.invoice()));

  protected readonly statusSeverity = computed(() => {
    switch (this.invoice().status) {
      case 'paid':
        return 'success' as const;
      case 'partial':
        return 'warn' as const;
      default:
        return 'danger' as const;
    }
  });

  // ── 催繳 ──────────────────────────────────────────────────────────────
  protected readonly reminders = signal<PaymentReminder[]>([]);
  protected readonly remindersLoading = signal(true);
  protected readonly reminderMethod = signal<ReminderMethod>('line');
  protected readonly reminderNote = signal('');
  protected readonly savingReminder = signal(false);

  protected readonly reminderMethodOptions = (
    Object.keys(REMINDER_METHOD_LABELS) as ReminderMethod[]
  ).map((value) => ({ value, label: REMINDER_METHOD_LABELS[value] }));

  // ── 列印 ──────────────────────────────────────────────────────────────
  private readonly invoicePrintArea =
    viewChild.required<ElementRef<HTMLElement>>('invoicePrintArea');
  private readonly receiptPrintArea =
    viewChild.required<ElementRef<HTMLElement>>('receiptPrintArea');

  constructor() {
    this.loadReminders();
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  private loadReminders(): void {
    this.remindersLoading.set(true);
    this.service.listReminders(this.invoice().id).subscribe({
      next: (res) => {
        this.reminders.set(res.data);
        this.remindersLoading.set(false);
      },
      // 催繳讀不到不該讓整張帳單看不了 —— 這一塊自己失敗就好
      error: () => {
        this.reminders.set([]);
        this.remindersLoading.set(false);
      },
    });
  }

  protected openPaymentDialog(kind: PaymentKind): void {
    const dialogRef = this.dialogService.open(PaymentFormDialogComponent, {
      header: kind === 'refund' ? '記錄退費' : '記錄收款',
      width: '440px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { invoice: this.invoice(), kind },
    });

    dialogRef?.onClose.subscribe((updated: Invoice | undefined) => {
      if (!updated) return;
      // 後端回的是重新推導過狀態的整張帳單，直接換掉不必再打一次 GET
      this.invoice.set(updated);
      this.dirty.set(true);
    });
  }

  protected addReminder(): void {
    this.savingReminder.set(true);
    this.service
      .createReminder(this.invoice().id, {
        method: this.reminderMethod(),
        note: this.reminderNote().trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '已記錄催繳',
            detail: '這次追繳留下了紀錄',
          });
          this.reminderNote.set('');
          this.savingReminder.set(false);
          this.loadReminders();
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '記錄失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.savingReminder.set(false);
        },
      });
  }

  protected printInvoice(): void {
    this.printNode(this.invoicePrintArea().nativeElement, '收費單');
  }

  protected printReceipt(): void {
    this.printNode(this.receiptPrintArea().nativeElement, '收據');
  }

  /**
   * 開一個乾淨的視窗印，**不用 `@media print` 藏東西**。
   *
   * dialog 是 modal，`window.print()` 會連同背後的遮罩與列表一起印出去；要壓掉它們
   * 得寫全域規則（`styles.scss` 不是這一席的邊界）。搬一份節點到空白視窗換來的是
   * 「印出來就是紙上該有的樣子」，而且列印版面本來就跟螢幕版面不同 ——
   * 那段樣式不是重複，是專門為紙寫的。
   *
   * 節點用 `importNode` 搬，不拼 HTML 字串 —— 學生姓名與備註是使用者輸入。
   */
  private printNode(node: HTMLElement, title: string): void {
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法開啟列印視窗',
        detail: '瀏覽器擋掉了彈出視窗，請允許本站的彈出視窗後再試',
      });
      return;
    }

    win.document.title = `${title} — ${this.invoice().studentName ?? ''}`;
    const style = win.document.createElement('style');
    style.textContent = PRINT_STYLES;
    win.document.head.appendChild(style);
    win.document.body.appendChild(win.document.importNode(node, true));

    // 有些瀏覽器要等一個 tick 才量得到版面
    win.setTimeout(() => {
      win.focus();
      win.print();
      win.close();
    }, 0);
  }

  protected close(): void {
    this.ref.close(this.dirty() ? this.invoice() : undefined);
  }
}

/** 紙上的版面。螢幕的 design token 在新視窗裡不存在，所以這裡是自足的絕對值 */
const PRINT_STYLES = `
  body { font-family: "Noto Sans TC", system-ui, sans-serif; color: #18181b; margin: 32px; }
  .print-doc__title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .print-doc__subtitle { font-size: 12px; color: #71717a; margin: 0 0 20px; }
  .print-doc__meta { font-size: 13px; line-height: 1.9; margin-bottom: 20px; }
  .print-doc__meta dt { display: inline; font-weight: 600; }
  .print-doc__meta dd { display: inline; margin: 0 16px 0 4px; }
  .print-doc__table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .print-doc__table th, .print-doc__table td { border-bottom: 1px solid #e4e4e7; padding: 8px 4px; text-align: left; }
  .print-doc__table th { font-weight: 600; }
  .print-doc__amount { text-align: right; font-variant-numeric: tabular-nums; }
  .print-doc__total { font-size: 15px; font-weight: 700; text-align: right; margin-top: 16px; }
  .print-doc__note { font-size: 12px; color: #71717a; margin-top: 24px; }
  .print-doc__sign { margin-top: 48px; font-size: 13px; display: flex; justify-content: space-between; }
`;
