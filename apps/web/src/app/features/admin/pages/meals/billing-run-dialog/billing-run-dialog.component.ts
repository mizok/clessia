import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { Router } from '@angular/router';

import { BillingRunsService, type BillingRunResult } from '@core/billing-runs.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

/**
 * 月結：把這個月「要收費且尚未結算」的餐費與學費加總成帳單。
 *
 * **run 是冪等的** —— 它只撈沒蓋過章的，處理完在同一個 transaction 裡蓋上
 * `invoice_item_id`。所以同一個月跑第二次不會產生第二張帳單，遲補的舊記錄下次
 * 會自動被撈進來。這一點要在 UI 上講出來：否則行政不敢按第二次，
 * 而「這個月到底跑過沒」正是他們會猶豫的地方。
 *
 * **`anomalies` 非空就是要人看的東西**（item 金額對不上蓋章的餐記錄總額），
 * 不要在成功訊息裡吞掉它。
 */
@Component({
  selector: 'app-billing-run-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, DatePickerModule],
  templateUrl: './billing-run-dialog.component.html',
  styleUrl: './billing-run-dialog.component.scss',
})
export class BillingRunDialogComponent {
  private readonly service = inject(BillingRunsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly router = inject(Router);

  /** 預設上個月 —— 月結通常在月初補跑上一個月 */
  protected month: Date = previousMonth();
  protected readonly running = signal(false);
  protected readonly result = signal<BillingRunResult | null>(null);

  protected run(): void {
    this.running.set(true);
    this.service.run({ periodMonth: format(this.month, 'yyyy-MM') }).subscribe({
      next: (res) => {
        this.result.set(res);
        this.running.set(false);

        if (res.anomalies.length > 0) {
          this.messageService.add({
            severity: 'warn',
            summary: `月結完成，但有 ${res.anomalies.length} 筆金額對不上`,
            detail: '下面列出來的帳單明細要人工核對',
            life: 10000,
          });
          return;
        }

        this.messageService.add({
          severity: 'success',
          summary: '月結完成',
          detail: `開立 ${res.invoicesCreated} 張帳單`,
        });
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '月結失敗',
          detail: err.error?.error || '請稍後再試',
        });
        this.running.set(false);
      },
    });
  }

  /** 跑過就回 true，讓名單重新取數看得到新的結算鎖 */
  protected close(): void {
    this.ref.close(this.result() !== null);
  }

  /**
   * 月結開出來的帳單要去哪看 —— 原本這個 dialog 說「開立 N 張帳單」就結束了，
   * 使用者得自己從側邊選單找到繳費紀錄。**產生了東西就要能走到它。**
   */
  protected goToInvoices(): void {
    this.ref.close(true);
    void this.router.navigate([RoutesCatalog.ADMIN_PAYMENTS.absolutePath]);
  }
}

function previousMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}
