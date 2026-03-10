import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Campus } from '@core/campuses.service';
import type { Course } from '@core/courses.service';
import type { Session } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { SESSION_STATUS_OPTIONS, DEFAULT_STATUSES } from '../../components/session-filters/session-filters.component';

export interface MobileFilterDialogData {
  readonly campuses: Campus[];
  readonly courses: Course[];
  readonly teachers: Staff[];
  readonly sessions: Session[];
  readonly classes: Array<{ id: string; name: string; courseId: string; campusId: string }>;
  readonly selectedCampusIds: string[];
  readonly selectedCourseIds: string[];
  readonly selectedTeacherIds: string[];
  readonly selectedClassId: string | null;
  readonly selectedStatuses: string[];
}

export interface MobileFilterDialogResult {
  readonly campusIds: string[];
  readonly courseIds: string[];
  readonly teacherIds: string[];
  readonly classId: string | null;
  readonly statuses: string[];
}

@Component({
  selector: 'app-mobile-filter-dialog',
  imports: [FormsModule, ButtonModule, SelectModule, MultiSelectModule],
  templateUrl: './mobile-filter-dialog.component.html',
  styleUrl: './mobile-filter-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileFilterDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig<MobileFilterDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly campuses = signal<Campus[]>([]);
  private readonly allCourses = signal<Course[]>([]);
  private readonly allTeachers = signal<Staff[]>([]);
  private readonly allSessions = signal<Session[]>([]);
  private readonly allClasses = signal<
    Array<{ id: string; name: string; courseId: string; campusId: string }>
  >([]);

  protected readonly selectedCampusIds = signal<string[]>([]);
  protected readonly selectedCourseIds = signal<string[]>([]);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedClassId = signal<string | null>(null);
  protected readonly selectedStatuses = signal<string[]>([...DEFAULT_STATUSES]);

  protected readonly statusOptions = SESSION_STATUS_OPTIONS;

  protected readonly availableCourses = computed(() => {
    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) return this.allCourses();
    return this.allCourses().filter((c) => campusIds.includes(c.campusId));
  });

  protected readonly availableTeachers = computed(() => {
    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) return this.allTeachers();

    let filtered = this.allTeachers().filter((t) =>
      t.campusIds.some((cid) => campusIds.includes(cid)),
    );

    const courseIds = this.selectedCourseIds();
    if (courseIds.length > 0) {
      const selectedCourses = this.allCourses().filter((c) => courseIds.includes(c.id));
      const subjectIds = new Set(selectedCourses.map((c) => c.subjectId));
      filtered = filtered.filter((t) => t.subjectIds.some((sid) => subjectIds.has(sid)));

      const assignedTeacherIds = new Set(
        this.allSessions()
          .filter(
            (s) =>
              campusIds.includes(s.campusId) &&
              courseIds.includes(s.courseId) &&
              s.assignmentStatus === 'assigned' &&
              !!s.teacherId,
          )
          .map((s) => s.teacherId)
          .filter((id): id is string => !!id),
      );
      filtered = filtered.filter((t) => assignedTeacherIds.has(t.id));
    }
    return filtered;
  });

  protected readonly availableTeacherGroups = computed<
    Array<{ label: string; items: Array<{ id: string; displayName: string }> }>
  >(() => {
    const groups: Array<{ label: string; items: Array<{ id: string; displayName: string }> }> = [
      { label: '篩選', items: [{ id: '__unassigned__', displayName: '未指派' }] },
    ];
    const teachers = this.availableTeachers();
    if (teachers.length > 0) {
      groups.push({ label: '老師', items: teachers });
    }
    return groups;
  });

  protected readonly availableClasses = computed(() => {
    const campusIds = this.selectedCampusIds();
    const courseIds = this.selectedCourseIds();
    if (campusIds.length === 0 || courseIds.length === 0) return [];
    return this.allClasses().filter(
      (c) => campusIds.includes(c.campusId) && courseIds.includes(c.courseId),
    );
  });

  protected readonly hasActiveFilters = computed(
    () =>
      this.selectedCourseIds().length > 0 ||
      this.selectedTeacherIds().length > 0 ||
      !!this.selectedClassId() ||
      !this.isDefaultStatuses(),
  );

  ngOnInit(): void {
    const data = this.config.data;
    if (!data) return;
    this.campuses.set(data.campuses);
    this.allCourses.set(data.courses);
    this.allTeachers.set(data.teachers);
    this.allSessions.set(data.sessions);
    this.allClasses.set(data.classes);
    this.selectedCampusIds.set([...data.selectedCampusIds]);
    this.selectedCourseIds.set([...data.selectedCourseIds]);
    this.selectedTeacherIds.set([...data.selectedTeacherIds]);
    this.selectedClassId.set(data.selectedClassId);
    this.selectedStatuses.set([...data.selectedStatuses]);
  }

  protected onCampusIdsChange(ids: string[]): void {
    this.selectedCampusIds.set(ids);
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
  }

  protected onCourseIdsChange(ids: string[]): void {
    this.selectedCourseIds.set(ids);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
  }

  protected onTeacherIdsChange(ids: readonly (string | Staff)[]): void {
    this.selectedTeacherIds.set(this.normalizeIdList(ids));
  }

  protected onClassChange(
    classValue: string | { readonly id: string; readonly name: string } | null,
  ): void {
    this.selectedClassId.set(this.toId(classValue));
  }

  protected clearFilters(): void {
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
    this.selectedStatuses.set([...DEFAULT_STATUSES]);
  }

  protected apply(): void {
    const result: MobileFilterDialogResult = {
      campusIds: this.selectedCampusIds(),
      courseIds: this.selectedCourseIds(),
      teacherIds: this.selectedTeacherIds(),
      classId: this.selectedClassId(),
      statuses: this.selectedStatuses(),
    };
    this.ref.close(result);
  }

  private isDefaultStatuses(): boolean {
    const current = [...this.selectedStatuses()].sort().join(',');
    const def = [...DEFAULT_STATUSES].sort().join(',');
    return current === def;
  }

  private toId(value: unknown): string | null {
    if (typeof value === 'string') return value.trim().length > 0 ? value : null;
    if (value && typeof value === 'object' && 'id' in value && typeof (value as { id: unknown }).id === 'string') {
      const id = (value as { id: string }).id.trim();
      return id.length > 0 ? id : null;
    }
    return null;
  }

  private normalizeIdList(values: readonly unknown[]): string[] {
    const ids = values.map((v) => this.toId(v)).filter((id): id is string => id !== null);
    return Array.from(new Set(ids));
  }
}
