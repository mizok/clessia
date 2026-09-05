import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Subject {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * 這個科目被幾門課程用著（`courses.subject_id` 是 `ON DELETE RESTRICT`，
   * API 端會擋刪除）。有這個數字，畫面才能事先灰掉刪除按鈕、說出原因，
   * 不用等 409 才知道 —— 跟 `Student.hasEnrollments` 同一個範本。
   */
  courseCount: number;
  /**
   * 這個科目被幾筆校內考用著（`academy_exams.subject_id` 是
   * `ON DELETE SET NULL`）。**這個關聯 API 端也擋了**，但因為底層 DB
   * 不會自己擋（會安靜清空欄位），這個數字對「先讓使用者知道」特別重要。
   */
  academyExamCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class SubjectsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;
  private readonly endpoint = `${this.baseUrl}/api/subjects`;

  list(): Observable<{ data: Subject[] }> {
    return this.http.get<{ data: Subject[] }>(this.endpoint);
  }

  create(name: string): Observable<{ data: Subject }> {
    return this.http.post<{ data: Subject }>(this.endpoint, { name });
  }

  update(id: string, name: string): Observable<{ data: Subject }> {
    return this.http.put<{ data: Subject }>(`${this.endpoint}/${id}`, { name });
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }
}
