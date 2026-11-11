import { Injectable } from '@angular/core';
import type { ParentStatus } from '@core/parents.service';

/** 離開家長列表時的篩選快照，導回後還原（#2396 L4：家長頁「新增學生」走手機整頁回來不重設） */
@Injectable({ providedIn: 'root' })
export class ParentsFilterStateService {
  searchQuery = '';
  selectedStatus: ParentStatus | null = null;
  currentPage = 1;
}
