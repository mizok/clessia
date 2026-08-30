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
  /** 已結算（蓋了 `invoice_item_id`）。要改得走帳單作廢或下期 adjustment（規則 2） */
  settled: boolean;
}

export interface MealRosterResponse {
  data: MealRosterRow[];
  /** org 的 `meal_default_price`。單價存在每一筆上，這只是新記錄的起始值 */
  defaultUnitPrice: number;
}

export interface MealBatchRow {
  studentId: string;
  ordered: boolean;
  chargeable?: boolean;
  unitPrice?: number;
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

  /** **只吃單日**，沒有日期區間也沒有分頁 —— 一天的候選名單量有限 */
  roster(date: string): Observable<MealRosterResponse> {
    return this.http.get<MealRosterResponse>(this.endpoint, { params: { date } });
  }

  batch(date: string, rows: MealBatchRow[]): Observable<MealBatchResponse> {
    return this.http.post<MealBatchResponse>(`${this.endpoint}/batch`, { date, rows });
  }
}
