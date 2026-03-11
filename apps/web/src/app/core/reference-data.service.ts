import { Injectable, inject, signal } from '@angular/core';
import { CampusesService, type Campus } from './campuses.service';
import { StaffService, type Staff } from './staff.service';
import { SubjectsService, type Subject } from './subjects.service';

type CacheKey = 'campuses' | 'subjects' | 'teachers';

/**
 * App-level reference data cache.
 * Lazily loads campuses, subjects, and teachers on first request;
 * subsequent calls within the same session reuse the cached signal values.
 * Call invalidate() after mutations to force a fresh fetch on the next access.
 */
@Injectable({ providedIn: 'root' })
export class ReferenceDataService {
  private readonly campusesApi = inject(CampusesService);
  private readonly subjectsApi = inject(SubjectsService);
  private readonly staffApi = inject(StaffService);

  readonly campuses = signal<Campus[]>([]);
  readonly subjects = signal<Subject[]>([]);
  readonly teachers = signal<Staff[]>([]);

  private readonly loaded: Record<CacheKey, boolean> = {
    campuses: false,
    subjects: false,
    teachers: false,
  };

  loadCampuses(): void {
    if (this.loaded['campuses']) return;
    this.loaded['campuses'] = true;
    this.campusesApi.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) => this.campuses.set(res.data),
      error: () => {
        this.loaded['campuses'] = false;
      },
    });
  }

  loadSubjects(): void {
    if (this.loaded['subjects']) return;
    this.loaded['subjects'] = true;
    this.subjectsApi.list().subscribe({
      next: (res) => this.subjects.set(res.data),
      error: () => {
        this.loaded['subjects'] = false;
      },
    });
  }

  loadTeachers(): void {
    if (this.loaded['teachers']) return;
    this.loaded['teachers'] = true;
    this.staffApi.list({ isActive: true, role: 'teacher', pageSize: 0 }).subscribe({
      next: (res) => this.teachers.set(res.data),
      error: () => {
        this.loaded['teachers'] = false;
      },
    });
  }

  invalidate(key: CacheKey): void {
    this.loaded[key] = false;
  }

  invalidateAll(): void {
    this.loaded['campuses'] = false;
    this.loaded['subjects'] = false;
    this.loaded['teachers'] = false;
  }
}
