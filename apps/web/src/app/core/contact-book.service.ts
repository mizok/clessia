import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 個人聯絡簿（國小模式）：學生 × 日期，每生每日唯一一則自由文字。
 * 業務真相見 kb/wiki/rules/contact-book-rules.md，管理端頁的設計見
 * kb/wiki/architecture/admin-contact-book-page.md。
 *
 * 跟教務日誌（班級 × 日期）是**兩個不同的東西**，只是口語裡都叫「聯絡簿」。
 *
 * **這支 API 沒有分頁** —— `GET` 回的是符合日期區間的全部，`meta.total` 是
 * `count: 'exact'`（跟 `/api/invoices` 那支不一樣，這個數字可以信）。
 * 量的控制靠日期區間，所以呼叫端一定要給 `from` / `to`。
 */

export interface ContactBookEntry {
  id: string;
  studentId: string;
  studentName: string | null;
  entryDate: string;
  content: string;
  /** 共編只記最後編輯者，不做分段作者（rules 3） */
  lastEditedByName: string | null;
  signedBy: string | null;
  signedAt: string | null;
  /** 後端算好的 —— 前端不要再從 signedAt 推一次 */
  isSigned: boolean;
}

export interface ContactBookQueryParams {
  studentId?: string;
  from?: string;
  to?: string;
}

export interface ContactBookListResponse {
  data: ContactBookEntry[];
  /** `count: 'exact'` —— 這個總數是對的 */
  meta: { total: number };
}

export interface UpsertContactBookEntryInput {
  studentId: string;
  entryDate: string;
  content: string;
}

@Injectable({ providedIn: 'root' })
export class ContactBookService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/contact-book`;

  list(params?: ContactBookQueryParams): Observable<ContactBookListResponse> {
    return this.http.get<ContactBookListResponse>(this.endpoint, { params: toQuery(params) });
  }

  /**
   * 每生每日一則的 upsert（`onConflict: student_id,entry_date`）。同一則被再寫一次
   * 就是共同編輯，後端換掉 `last_edited_by`。
   *
   * ⚠️ 這支回的是**裸的 entry**，不是 `{ data }` —— 跟 `list()` 的包法不一致，
   * 是後端既有的形狀，不要順手包一層。
   */
  upsert(input: UpsertContactBookEntryInput): Observable<ContactBookEntry> {
    return this.http.put<ContactBookEntry>(this.endpoint, input);
  }
}

function toQuery(params?: ContactBookQueryParams): Record<string, string> {
  if (!params) return {};

  const query: Record<string, string> = {};
  if (params.studentId) query['studentId'] = params.studentId;
  if (params.from) query['from'] = params.from;
  if (params.to) query['to'] = params.to;
  return query;
}
