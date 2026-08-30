import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 每月／每期的帳務作業（run）。見 kb/wiki/rules/billing-rules.md。
 *
 * **run 是冪等的**：它只撈「要收費且尚未結算」的東西，處理完在同一個 transaction 裡
 * 蓋上 `invoice_item_id`。所以遲補的舊記錄下次會自動被撈進來，已結的不會重複收 ——
 * 同一個月跑第二次不會產生第二張帳單。
 */

/**
 * 三步式月結的安全網：item 金額對不上蓋章的餐記錄總額。
 * **非空就是要人看的東西**，不要在 UI 裡吞掉。
 */
export interface BillingRunAnomaly {
  invoiceItemId: string;
  itemAmount: number;
  stampedTotal: number;
  expectedAmount: number;
}

export interface BillingRunResult {
  invoicesCreated: number;
  tuitionItems: number;
  mealItems: number;
  mealRecordsSettled: number;
  anomalies: BillingRunAnomaly[];
}

export interface BillingRunInput {
  /** 月 run：`2026-03` 或 `2026-03-01` 都收。與 `billingPeriodId` **二擇一** */
  periodMonth?: string;
  /** 期 run */
  billingPeriodId?: string;
  dueDate?: string;
}

@Injectable({ providedIn: 'root' })
export class BillingRunsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/billing-runs`;

  run(input: BillingRunInput): Observable<BillingRunResult> {
    return this.http.post<BillingRunResult>(this.endpoint, input);
  }
}
