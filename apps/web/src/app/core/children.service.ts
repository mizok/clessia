import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Child {
  id: string;
  name: string;
  grade: string;
  /**
   * 學校名。**`null` = 這個學生沒有指定學校**（`students.school_id` 是 nullable）。
   * 後端不回 `''` —— 空字串會讓「沒設定」跟「學校叫做空字串」長得一樣。
   */
  school: string | null;
}

export interface ChildrenListResponse {
  data: Child[];
}

@Injectable({ providedIn: 'root' })
export class ChildrenService {
  private readonly http = inject(HttpClient);

  list(): Observable<ChildrenListResponse> {
    return this.http.get<ChildrenListResponse>(`${environment.apiUrl}/api/me/children`);
  }
}
