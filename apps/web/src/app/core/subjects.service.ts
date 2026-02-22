import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface Subject {
  id: string;
  name: string;
  sortOrder: number;
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
