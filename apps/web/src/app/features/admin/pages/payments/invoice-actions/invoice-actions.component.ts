import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { MenuItem } from 'primeng/api';

import type { Invoice } from '@core/invoices.service';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';

import { canCollect, canReceipt } from '../payments.util';

/**
 * 帳單列尾的鈕（A6）：收款／收據。**各自只在做得了的時候出現**
 * （條件在 `payments.util` 的 `canCollect`／`canReceipt`，有單元測試）。
 * 「提醒」（記一次催繳）在 #1625 拿掉：聯絡家長改在帳單詳情，點那一列就開。
 *
 * 只發事件，不開 dialog：開什麼是頁面的事（頁面持有 DialogService）。
 */
@Component({
  selector: 'app-invoice-actions',
  imports: [PopupMenuComponent],
  templateUrl: './invoice-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceActionsComponent {
  readonly invoice = input.required<Invoice>();
  /**
   * 精簡版（A6 帳單章的列）：只留**一顆主要鈕**（能收款就收款、否則收據），
   * 其餘收進列尾「⋯」。表格版不傳，維持三顆並排。
   */
  readonly compact = input(false);

  readonly collect = output<void>();
  readonly receipt = output<void>();

  protected readonly name = computed(() => this.invoice().studentName ?? '未知學生');
  protected readonly showCollect = computed(() => canCollect(this.invoice()));
  protected readonly showReceipt = computed(() => canReceipt(this.invoice()));

  /** 精簡版的主要鈕：收款 → 收據，第一個做得了的（「提醒」在 #1625 拿掉） */
  protected readonly primary = computed<'collect' | 'receipt' | null>(() => {
    if (this.showCollect()) return 'collect';
    if (this.showReceipt()) return 'receipt';
    return null;
  });

  /** 精簡版收進「⋯」的動作（主要鈕以外、做得了的） */
  protected readonly overflowItems = computed<MenuItem[]>(() => {
    const primary = this.primary();
    const items: MenuItem[] = [];
    if (primary !== 'collect' && this.showCollect()) {
      items.push({ label: '收款', icon: 'pi pi-wallet', command: () => this.collect.emit() });
    }
    if (primary !== 'receipt' && this.showReceipt()) {
      items.push({ label: '收據', icon: 'pi pi-receipt', command: () => this.receipt.emit() });
    }
    return items;
  });
}
