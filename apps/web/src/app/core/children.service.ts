import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Child {
  id: string;
  name: string;
  grade: string;
  school: string;
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
