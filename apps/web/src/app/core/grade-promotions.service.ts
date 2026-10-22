import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '@env/environment';
import type { GradeLevel as Grade } from './students.service';

/**
 * 學年升級（#1820）。設計稿 `kb/wiki/specs/admin/system/grade-promotion.md`。
 * 四支端點都要 `manage_students`＋`all_campuses`（只管部分分校的管理員一律 403）。
 */

export interface GradePromotionPreview {
  /** 民國年 */
  academicYear: number;
  /** 這一學年已經升過、還沒復原 —— 不給執行 */
  alreadyPromoted: boolean;
  /** `to` 是 null＝高三畢業（改停用） */
  transitions: { from: Grade; to: Grade | null; count: number }[];
  promotedCount: number;
  graduatedCount: number;
  /** 升級後的年級跟學校學制不合，要行政改學校 */
  schoolMismatch: { studentId: string; name: string; schoolName: string; newGrade: Grade }[];
  /** 高三畢業但還有在籍報名 —— 升級不退班，名單交給行政 */
  graduatesWithEnrollments: { studentId: string; name: string; classNames: string[] }[];
}

export interface GradePromotionResult {
  promotionId: string;
  academicYear: number;
  promotedCount: number;
  graduatedCount: number;
}

export interface GradePromotionRecord {
  id: string;
  academicYear: number;
  executedAt: string;
  revertedAt: string | null;
  /** 還在 30 天內、也還沒復原 */
  revertible: boolean;
  studentCount: number;
}

export interface GradePromotionRevertResult {
  revertedCount: number;
  /** 升級後年級被手改過、沒有還原的學生 */
  skipped: { studentId: string; name: string }[];
}

@Injectable({ providedIn: 'root' })
export class GradePromotionsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/grade-promotions`;

  preview(): Observable<GradePromotionPreview> {
    return this.http.get<GradePromotionPreview>(`${this.endpoint}/preview`);
  }

  execute(): Observable<GradePromotionResult> {
    return this.http.post<GradePromotionResult>(this.endpoint, {});
  }

  history(): Observable<{ data: GradePromotionRecord[] }> {
    return this.http.get<{ data: GradePromotionRecord[] }>(this.endpoint);
  }

  revert(id: string): Observable<GradePromotionRevertResult> {
    return this.http.post<GradePromotionRevertResult>(`${this.endpoint}/${id}/revert`, {});
  }
}
