import { Injectable } from '@angular/core';

/** 離開 CoursesPage 時的 filter 快照，用於導回後還原狀態 */
@Injectable({ providedIn: 'root' })
export class CoursesFilterStateService {
  searchQuery = '';
  selectedSubjectId: string | null = null;
  selectedTeacherIds: string[] = [];
  statusFilter: boolean | 'intervention' | null = null;
  showHistorical = false;
  historicalDateFrom: Date | null = null;
  historicalDateTo: Date | null = null;
  currentPage = 1;
  /** 展開中的課程（#2396 L4：手機整頁表單回來不要全收合） */
  expandedCourseIds: string[] = [];
}
