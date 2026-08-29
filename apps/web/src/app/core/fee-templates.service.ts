import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 價目表：org 層的定價，報名時挑選。見 kb/wiki/specs/admin/finance/fee-templates.md。
 *
 * **沒有分頁** —— 一個機構的價目表是十幾筆的量級，後端也沒做分頁，回的是裸的 `{ data }`。
 * **沒有折扣欄位**，這是刻意的（billing-rules 規則 2）：實際談定的金額存在
 * `enrollments.agreedAmount`，不是在這裡打折。
 */

/** 計費模式是**報名層級**的選擇；價目表上的值只代表「這個方案適用哪種收法」 */
export type BillingMode = 'monthly' | 'period' | 'session_pack';

export const BILLING_MODE_LABELS: Readonly<Record<BillingMode, string>> = {
  monthly: '月繳',
  period: '期繳',
  session_pack: '堂數制',
};

export interface FeeTemplate {
  id: string;
  orgId: string;
  name: string;
  billingMode: BillingMode;
  /** 整數 —— 台幣沒有小數。這是**定價**，不是實收 */
  amount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeeTemplateQueryParams {
  search?: string;
  isActive?: boolean;
  billingMode?: BillingMode;
}

export interface CreateFeeTemplateInput {
  name: string;
  billingMode: BillingMode;
  amount: number;
  isActive?: boolean;
}

export interface UpdateFeeTemplateInput {
  name?: string;
  billingMode?: BillingMode;
  amount?: number;
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FeeTemplatesService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/fee-templates`;

  list(params?: FeeTemplateQueryParams): Observable<{ data: FeeTemplate[] }> {
    return this.http.get<{ data: FeeTemplate[] }>(this.endpoint, {
      params: toQuery(params),
    });
  }

  create(input: CreateFeeTemplateInput): Observable<{ data: FeeTemplate }> {
    return this.http.post<{ data: FeeTemplate }>(this.endpoint, input);
  }

  update(id: string, input: UpdateFeeTemplateInput): Observable<{ data: FeeTemplate }> {
    return this.http.put<{ data: FeeTemplate }>(`${this.endpoint}/${id}`, input);
  }

  /**
   * FK 是 RESTRICT —— **被任何報名引用過就刪不掉**，後端會回錯誤。
   * 呼叫端要顯示那個錯誤，不能樂觀更新後假裝成功。停用（`isActive: false`）才是常態。
   */
  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }
}

/** `isActive: false` 被當成「沒給」是這種轉換最典型的錯法，所以顯式比對 undefined */
function toQuery(params?: FeeTemplateQueryParams): Record<string, string> {
  if (!params) return {};

  const query: Record<string, string> = {};
  if (params.search) query['search'] = params.search;
  if (params.isActive !== undefined) query['isActive'] = String(params.isActive);
  if (params.billingMode !== undefined) query['billingMode'] = params.billingMode;
  return query;
}
