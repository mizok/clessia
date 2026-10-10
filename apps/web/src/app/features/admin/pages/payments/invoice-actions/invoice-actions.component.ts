import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { Invoice } from '@core/invoices.service';

import { canCollect, canReceipt, canRemind } from '../payments.util';

/**
 * 帳單列尾的三顆鈕（A6）：提醒／收款／收據。**各自只在做得了的時候出現**
 * （條件在 `payments.util` 的 `canRemind`／`canCollect`／`canReceipt`，有單元測試）——
 * 按下去才發現「這張不能提醒」是 A6 稿沒有的體驗。
 *
 * 只發事件，不開 dialog：開什麼、記什麼是頁面的事（頁面持有 DialogService 與選單）。
 * 「提醒」的事件帶 `MouseEvent`，頁面要把方式選單錨在這顆鈕上。
 */
@Component({
  selector: 'app-invoice-actions',
  imports: [],
  templateUrl: './invoice-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceActionsComponent {
  readonly invoice = input.required<Invoice>();

  readonly remind = output<MouseEvent>();
  readonly collect = output<void>();
  readonly receipt = output<void>();

  protected readonly name = computed(() => this.invoice().studentName ?? '未知學生');
  protected readonly showRemind = computed(() => canRemind(this.invoice()));
  protected readonly showCollect = computed(() => canCollect(this.invoice()));
  protected readonly showReceipt = computed(() => canReceipt(this.invoice()));
}
