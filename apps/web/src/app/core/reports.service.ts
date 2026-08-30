import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 營收報表的聚合端點。見 kb/wiki/specs/admin/finance/reports.md。
 *
 * **這支存在的理由是 spec 的 🔴 實作陷阱**：列表 API 的 `pageSize` 上限是 100，
 * 抓一頁明細自己加總會在量大的月份**悄悄少算而且錯得沒有任何徵兆** ——
 * 報表看起來完全正常，只是數字是錯的。所以**前端一個數字都不加總**，
 * 全部從這裡拿。
 *
 * 權限是 **`view_reports` 不是 `manage_finance`**：前者唯讀（看營收），
 * 後者會寫（改價目表、開帳單、收款）。老闆可能只給主任看報表而不給動錢。
 */

export interface RevenueFigures {
  /** 區間內 `payment_records` 的正向金額總和 */
  received: number;
  /**
   * 區間內的退款總和。**單獨列不要跟實收淨額混算** ——
   * 「收了 10 萬、退了 3 萬」與「收了 7 萬」是兩個不同的經營訊號。
   */
  refunded: number;
  /** 區間內**開出**的帳單應繳總額（收款看收款日、帳單看開帳日，兩個區間語意不同） */
  billed: number;
  /** `billed` 減掉那些帳單至今收到的淨額 */
  outstanding: number;
  /** `outstanding` 裡面已經過了 `due_date` 的部分 */
  overdueOutstanding: number;
}

/**
 * 分組的一列。
 *
 * `key` 可能是**明著標出來的模糊桶**：`（跨分校）`、`（跨課程）`、`（未分類）`。
 * 一張帳單可以跨班（同一個學生修兩科）也可以完全沒有班（純餐費帳單），後端
 * 刻意不做比例拆分（拆出來的數字沒有人能跟收據對得起來）也不重複計入多個組
 * （那會讓小計加起來大於總計）。
 *
 * **所以 UI 要照實顯示這幾個桶，不要藏、不要合併、不要重新命名** ——
 * 它們的存在就是為了讓小計永遠加得回總計，而模糊的地方是看得見的。
 */
export interface RevenueGroup extends RevenueFigures {
  key: string;
}

export type RevenueGroupBy = 'campus' | 'course' | 'month';

export interface RevenueQueryParams {
  dateFrom: string;
  dateTo: string;
  campusId?: string;
  courseId?: string;
  /** 後端預設 `campus` */
  groupBy?: RevenueGroupBy;
}

export interface RevenueResponse {
  summary: RevenueFigures;
  groups: RevenueGroup[];
}

export const REVENUE_GROUP_BY_LABELS: Readonly<Record<RevenueGroupBy, string>> = {
  campus: '分校',
  course: '課程',
  month: '月份',
};

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/reports`;

  revenue(params: RevenueQueryParams): Observable<RevenueResponse> {
    const query: Record<string, string> = {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    };
    if (params.campusId) query['campusId'] = params.campusId;
    if (params.courseId) query['courseId'] = params.courseId;
    if (params.groupBy) query['groupBy'] = params.groupBy;

    return this.http.get<RevenueResponse>(`${this.endpoint}/revenue`, { params: query });
  }
}
