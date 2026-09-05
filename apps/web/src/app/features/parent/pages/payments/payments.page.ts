import { DecimalPipe } from '@angular/common';
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

import { DrawerModule } from 'primeng/drawer';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import { ParentBillingService, type ParentInvoice } from '@core/parent-billing.service';
import { BandAnchorComponent } from '@shared/components/page-band/band-anchor/band-anchor.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import {
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  groupInvoices,
  latestPaymentDate,
} from './payments.util';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-payments',
  standalone: true,
  imports: [
    DecimalPipe,
    DrawerModule,
    PageBandComponent,
    ChildSwitcherComponent,
    BandAnchorComponent,
    EmptyStateComponent,
  ],
  templateUrl: './payments.page.html',
  styleUrl: './payments.page.scss',
})
export class PaymentsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly billingService = inject(ParentBillingService);

  protected readonly invoices = signal<ParentInvoice[]>([]);
  protected readonly total = signal(0);
  protected readonly totalDue = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly selectedInvoice = signal<ParentInvoice | null>(null);
  protected readonly drawerVisible = signal(false);

  protected readonly groups = computed(() => groupInvoices(this.invoices()));
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

  protected latestPaymentDate(invoice: ParentInvoice): string | null {
    return latestPaymentDate(invoice);
  }

  protected openDetail(invoice: ParentInvoice): void {
    this.selectedInvoice.set(invoice);
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
