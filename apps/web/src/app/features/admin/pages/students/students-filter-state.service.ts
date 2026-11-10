import { Injectable } from '@angular/core';
import type { GradeLevel, StudentTodayFilter } from '@core/students.service';

/**
 * 離開學生列表時的篩選快照，導回後還原（#2396 L4：手機整頁學生表單存完回來不重設；
 * 點進學生詳情再回來也保留）。同 courses 的 CoursesFilterStateService
 */
@Injectable({ providedIn: 'root' })
export class StudentsFilterStateService {
  searchQuery = '';
  selectedGrade: GradeLevel | null = null;
  statusFilter: 'active' | 'inactive' | 'all' = 'active';
  todayFilter: StudentTodayFilter | null = null;
  schoolMismatch = false;
  cardFilter: 'without' | 'today' | null = null;
  currentPage = 1;
}
