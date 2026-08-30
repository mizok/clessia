import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 餐務：每日名單。見 kb/wiki/rules/meal-rules.md 與 kb/wiki/specs/admin/finance/meals.md。
 *
 * **訂餐與出席解耦**（規則 1）：課表只產生候選名單，實際以每日的 `meal_records` 為準。
 * **「收不收費」是人工開關不是規則**（規則 3）——「便當已經送到了才請假」是人工裁量，
 * 不要在前端自動化任何截止邏輯。
 */

export interface MealRosterRow {
  studentId: string;
  studentName: string;
  /**
   * 班級脈絡。**是陣列** —— 一個學生同一天可能在兩個有課的班，而餐記錄是
   * `UNIQUE (student_id, meal_date)`：一天一筆便當，不分班。
   * **區間模式回的是空陣列**（見 `range()`）。
   */
  classNames: string[];
  mealDate: string;
  /** 這個學生預設訂不訂餐（`students.meal_default`），決定候選名單上的預設勾選 */
  mealDefault: boolean;
  /**
   * 已經有記錄就帶出來，**`null` 代表這天還沒有人處理過他** ——
   * 「沒訂」與「沒處理」是兩件事，`ordered: false` 才是明確的沒訂。
   */
  recordId: string | null;
  ordered: boolean | null;
  chargeable: boolean | null;
  unitPrice: number | null;
  note: string | null;
  /** 已結算（蓋了 `invoice_item_id`）。要改得走帳單作廢或下期 adjustment（規則 2） */
  settled: boolean;
}

/**
 * 一段期間的統計，**後端算整個區間的不是當頁的**。
 *
 * `totalAmount` 問的是「這段期間吃了多少錢」，所以**已結算的照樣算進去** ——
 * 它不是「還有多少沒收」。`total` 是餐記錄筆數，含沒訂的那些
 * （「沒訂」跟「沒人處理」要分得出來）。
 */
export interface MealSummary {
  total: number;
  chargeableCount: number;
  totalAmount: number;
  settledCount: number;
  page: number;
  pageSize: number;
}

export interface MealRosterResponse {
  data: MealRosterRow[];
  /** org 的 `meal_default_price`。單價存在每一筆上，這只是新記錄的起始值 */
  defaultUnitPrice: number;
  meta: MealSummary;
}

export interface MealBatchRow {
  studentId: string;
  ordered: boolean;
  chargeable?: boolean;
  unitPrice?: number;
  note?: string | null;
}

export interface MealBatchResponse {
  updated: number;
  /**
   * 已結算、因此**這次沒有被改動**的學生。後端不是靜靜跳過 ——
   * 呼叫端要把它顯示出來，行政才知道哪幾筆沒改到。
   */
  lockedStudentIds: string[];
}

/** 後端 `POST /api/meals/batch` 的 `rows` 上限 */
export const MEAL_BATCH_MAX_ROWS = 300;

@Injectable({ providedIn: 'root' })
export class MealsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/meals`;

  /**
   * **單日模式**：課表候選 + 既有記錄。`recordId === null` 的那些是候選裡還沒處理的。
   * 只有這個模式回得到 `classNames` 與 `mealDefault` —— 也只有這個模式能編輯。
   */
  roster(date: string): Observable<MealRosterResponse> {
    return this.http.get<MealRosterResponse>(this.endpoint, { params: { date } });
  }

  /**
   * **區間模式**：只回**實際存在的餐記錄**，沒有「候選」的概念
   * （要知道三個月前某天誰「應該」訂餐得把當天課表重推一次，昂貴又沒用）。
   *
   * 因此 `classNames` 是空陣列、`mealDefault` 是 false —— 這個不對稱是後端刻意的，
   * 列的形狀保持一致好讓前端共用同一個 row。
   *
   * **這個模式是唯讀的**：`batch()` 吃的是單一 `date`，跨天的修改沒有對應的端點。
   */
  range(params: {
    dateFrom: string;
    dateTo: string;
    studentId?: string;
    page?: number;
    pageSize?: number;
  }): Observable<MealRosterResponse> {
    const query: Record<string, string> = {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    };
    if (params.studentId) query['studentId'] = params.studentId;
    if (params.page !== undefined) query['page'] = String(params.page);
    if (params.pageSize !== undefined) query['pageSize'] = String(params.pageSize);

    return this.http.get<MealRosterResponse>(this.endpoint, { params: query });
  }

  batch(date: string, rows: MealBatchRow[]): Observable<MealBatchResponse> {
    return this.http.post<MealBatchResponse>(`${this.endpoint}/batch`, { date, rows });
  }
}
