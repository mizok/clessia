import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

import { RouterLink } from '@angular/router';
import { DrawerModule } from 'primeng/drawer';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentBillingService,
  type ParentInvoice,
  type ParentInvoiceListResponse,
} from '@core/parent-billing.service';
import { SystemClockService } from '@core/system-clock.service';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';
import { BandAnchorComponent } from '@shared/components/page-band/band-anchor/band-anchor.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import {
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  dueTag,
  groupInvoices,
  invoiceTitle,
  latestPaymentDate,
  monthDay,
} from './payments.util';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [
    DecimalPipe,
    NgTemplateOutlet,
    RouterLink,
    ChapterHeadComponent,
    StatusDotComponent,
    DrawerModule,
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    BandAnchorComponent,
    EmptyStateComponent,
  ],
  templateUrl: './payments.page.html',
})
export class PaymentsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly billingService = inject(ParentBillingService);
  protected readonly today = inject(SystemClockService).todayTaipei;

  protected readonly invoices = signal<ParentInvoice[]>([]);
  protected readonly total = signal(0);
  protected readonly totalDue = signal(0);
  /** 本學期已繳（#1314 PP1），`meta.term.paid`；沒有涵蓋今天的收費期間 → null（不畫這個數字） */
  protected readonly termPaid = signal<number | null>(null);
  protected readonly copiedText = signal<string | null>(null);
  /** 補習班帳戶資訊（#1073），待付款詳情列出；空陣列退回「請洽行政人員」 */
  protected readonly paymentInfo = signal<ParentInvoiceListResponse['meta']['paymentInfo']>([]);
  protected readonly currentPage = signal(1);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly selectedInvoice = signal<ParentInvoice | null>(null);
  protected readonly drawerVisible = signal(false);

  protected readonly groups = computed(() => groupInvoices(this.invoices()));
  protected readonly childName = computed(() => this.childScope.activeChild()?.name ?? '孩子');
  /**
   * 最近的期限＝待繳裡最早的期限日（逾期的也算，會多寫「已經過了」）。
   * ponytail: 只看已載入的那幾頁；待繳超過一頁時可能漏掉更早的，等有人真的有 20 張以上再說。
   */
  protected readonly nextDue = computed(
    () =>
      this.groups()
        .pending.map((i) => i.dueDate)
        .filter((d): d is string => d !== null)
        .sort()[0] ?? null,
  );
  protected readonly chapters = computed(() => [
    { kind: 'pending', name: '待繳', rows: this.groups().pending, empty: '目前沒有待繳的帳單。' },
    { kind: 'paid', name: '已繳清', rows: this.groups().paid, empty: '還沒有繳清的帳單。' },
  ]);
  protected readonly hasMore = computed(() => this.invoices().length < this.total());
  protected readonly itemTypeLabels = INVOICE_ITEM_TYPE_LABELS;
  protected readonly paymentMethodLabels = PAYMENT_METHOD_LABELS;
  protected readonly statusLabels = INVOICE_STATUS_LABELS;

  constructor() {
    effect(() => {
      const childId = this.childScope.activeChildId();
      if (!childId) return;
      untracked(() => this.load(childId, 1));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected readonly monthDay = monthDay;

  protected title(invoice: ParentInvoice): string {
    return invoiceTitle(invoice);
  }

  protected dueTag(invoice: ParentInvoice) {
    return dueTag(invoice, this.today());
  }

  protected copyAccount(text: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => this.copiedText.set(text))
      .catch(() => undefined); // 權限被拒時帳戶資訊本來就選得到，不跳錯
  }

  protected latestPaymentDate(invoice: ParentInvoice): string | null {
    return latestPaymentDate(invoice);
  }

  protected openDetail(invoice: ParentInvoice): void {
    this.selectedInvoice.set(invoice);
    this.copiedText.set(null);
    this.drawerVisible.set(true);
  }

  protected closeDetail(): void {
    this.drawerVisible.set(false);
  }

  protected onDrawerVisibleChange(visible: boolean): void {
    this.drawerVisible.set(visible);
  }

  protected loadMore(): void {
    const childId = this.childScope.activeChildId();
    if (!childId) return;
    this.load(childId, this.currentPage() + 1, true);
  }

  private load(childId: string, page: number, append = false): void {
    this.loading.set(true);
    this.failed.set(false);

    this.billingService.list({ childId, page, pageSize: PAGE_SIZE }).subscribe({
      next: (res) => {
        this.invoices.set(append ? [...this.invoices(), ...res.data] : res.data);
        this.total.set(res.meta.total);
        this.totalDue.set(res.meta.totalDue);
        this.termPaid.set(res.meta.term?.paid ?? null);
        this.paymentInfo.set(res.meta.paymentInfo);
        this.currentPage.set(page);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
        if (!append) {
          this.invoices.set([]);
          this.total.set(0);
        }
      },
    });
  }
}
