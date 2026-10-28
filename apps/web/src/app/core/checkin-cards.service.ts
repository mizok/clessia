import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';

/**
 * 到班卡（#1100 #42）：一張卡一個可作廢的代碼（`CK1-`＋16 碼）。
 * 權限在後端分：重印 `basic_operations`；新開、補發、作廢 `manage_students`。
 */
export interface PrintedCheckinCard {
  studentId: string;
  studentName: string;
  code: string;
  /** 這次才開的（之前沒有有效卡）；false＝重印同一張 */
  issued: boolean;
}

export interface StudentCheckinCard {
  active: { code: string; issuedAt: string } | null;
  /** 印過新卡（舊版 QR＝學生 id 的卡已失效） */
  hasAnyCard: boolean;
}

@Injectable({ providedIn: 'root' })
export class CheckinCardsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/checkin-cards`;

  /** 有有效卡就回那張（重印不換碼），沒有就開新卡。有人沒卡而沒有 manage_students → 403 */
  print(studentIds: readonly string[]): Observable<{ data: PrintedCheckinCard[] }> {
    return this.http.post<{ data: PrintedCheckinCard[] }>(`${this.base}/print`, { studentIds });
  }

  get(studentId: string): Observable<StudentCheckinCard> {
    return this.http.get<StudentCheckinCard>(`${this.base}/students/${studentId}`);
  }

  /** 補發：舊卡立即作廢＋開新卡 */
  reissue(
    studentId: string,
    reason: string,
  ): Observable<{ studentId: string; studentName: string; code: string }> {
    return this.http.post<{ studentId: string; studentName: string; code: string }>(
      `${this.base}/${studentId}/reissue`,
      { reason },
    );
  }

  revoke(studentId: string, reason: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${studentId}/revoke`, { reason });
  }
}

/** 卡面的分組顯示：`CK1-XXXX-XXXX-XXXX-XXXX`（DB 存不分組的） */
export function formatCardCode(code: string): string {
  return `CK1-${(code.slice(4).match(/.{1,4}/g) ?? []).join('-')}`;
}
