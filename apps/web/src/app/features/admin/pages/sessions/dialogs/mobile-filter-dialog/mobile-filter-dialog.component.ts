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
import { MultiSelectModule } from 'primeng/multiselect';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Campus } from '@core/campuses.service';
import type { Course } from '@core/courses.service';
import type { Session } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { ImeFilterInputComponent } from '@shared/components/ime-filter-input/ime-filter-input.component';
import {
  SESSION_STATUS_OPTIONS,
  DEFAULT_STATUSES,
} from '../../components/session-filters/session-filters.component';

export interface MobileFilterDialogData {
  readonly campuses: Campus[];
  readonly courses: Course[];
  readonly teachers: Staff[];
  readonly sessions: Session[];
  readonly classes: Array<{ id: string; name: string; courseId: string; campusId: string }>;
  readonly selectedCampusIds: string[];
  readonly selectedCourseIds: string[];
  readonly selectedTeacherIds: string[];
  readonly selectedClassIds: string[];
  readonly selectedStatuses: string[];
}

export interface MobileFilterDialogResult {
  readonly campusIds: string[];
  readonly courseIds: string[];
  readonly teacherIds: string[];
  readonly classIds: string[];
  readonly statuses: string[];
}

interface MobileFilterClassDisplayOption {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  readonly campusId: string;
  readonly courseName: string | null;
  readonly campusName: string | null;
}

@Component({
  selector: 'app-mobile-filter-dialog',
  imports: [FormsModule, ButtonModule, MultiSelectModule, ImeFilterInputComponent],
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
  protected readonly selectedClassIds = signal<string[]>([]);
  protected readonly selectedStatuses = signal<string[]>([...DEFAULT_STATUSES]);
  protected readonly courseFilterQuery = signal('');
  protected readonly classFilterQuery = signal('');

  protected readonly statusOptions = SESSION_STATUS_OPTIONS;

  protected readonly availableCourses = computed(() => {
    const campusIds = this.selectedCampusIds();
    const courses =
      campusIds.length === 0
        ? this.allCourses()
        : this.allCourses().filter((course) => campusIds.includes(course.campusId));

    return this.matchByQuery(courses, this.courseFilterQuery(), (course) => [
      course.name,
      course.campusName ?? this.campusNameById().get(course.campusId),
    ]);
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
    if (courseIds.length === 0) return [];

    const classes = this.allClasses().filter(
      (classOption) =>
        courseIds.includes(classOption.courseId) &&
        (campusIds.length === 0 || campusIds.includes(classOption.campusId)),
    );

    return this.matchByQuery(classes, this.classFilterQuery(), (classOption) => [
      classOption.name,
      this.courseNameById().get(classOption.courseId),
      this.campusNameById().get(classOption.campusId),
    ]);
  });

  protected readonly campusNameById = computed(
    () => new Map(this.campuses().map((campus) => [campus.id, campus.name])),
  );
  protected readonly courseNameById = computed(
    () => new Map(this.allCourses().map((course) => [course.id, course.name])),
  );
  protected readonly classDisplayOptions = computed<MobileFilterClassDisplayOption[]>(() =>
    this.availableClasses().map((classOption) => ({
      ...classOption,
      courseName: this.courseNameById().get(classOption.courseId) ?? null,
      campusName: this.campusNameById().get(classOption.campusId) ?? null,
    })),
  );

  protected readonly hasActiveFilters = computed(
    () =>
      this.selectedCourseIds().length > 0 ||
      this.selectedTeacherIds().length > 0 ||
      this.selectedClassIds().length > 0 ||
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
    this.selectedClassIds.set([...data.selectedClassIds]);
    this.selectedStatuses.set([...data.selectedStatuses]);
  }

  protected onCampusIdsChange(ids: string[]): void {
    this.selectedCampusIds.set(ids);
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
  }

  protected onCourseIdsChange(ids: string[]): void {
    this.selectedCourseIds.set(ids);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
  }

  protected onTeacherIdsChange(ids: readonly (string | Staff)[]): void {
    this.selectedTeacherIds.set(this.normalizeIdList(ids));
  }

  protected onClassIdsChange(values: readonly (string | { readonly id: string })[]): void {
    this.selectedClassIds.set(this.normalizeIdList(values));
  }

  protected clearFilters(): void {
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStatuses.set([...DEFAULT_STATUSES]);
  }

  protected apply(): void {
    const result: MobileFilterDialogResult = {
      campusIds: this.selectedCampusIds(),
      courseIds: this.selectedCourseIds(),
      teacherIds: this.selectedTeacherIds(),
      classIds: this.selectedClassIds(),
      statuses: this.selectedStatuses(),
    };
    this.ref.close(result);
  }

  protected getCourseCampusName(course: Course): string | null {
    return course.campusName ?? this.campusNameById().get(course.campusId) ?? null;
  }

  protected getTeacherSubjectLabel(teacher: { readonly subjectNames?: string[] }): string | null {
    if (!teacher.subjectNames || teacher.subjectNames.length === 0) {
      return null;
    }
    return teacher.subjectNames.join('、');
  }

  protected getClassMetaLabel(classOption: MobileFilterClassDisplayOption): string | null {
    const parts = [classOption.courseName, classOption.campusName].filter(
      (value): value is string => !!value,
    );
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private isDefaultStatuses(): boolean {
    const current = [...this.selectedStatuses()].sort().join(',');
    const def = [...DEFAULT_STATUSES].sort().join(',');
    return current === def;
  }

  private toId(value: unknown): string | null {
    if (typeof value === 'string') return value.trim().length > 0 ? value : null;
    if (
      value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as { id: unknown }).id === 'string'
    ) {
      const id = (value as { id: string }).id.trim();
      return id.length > 0 ? id : null;
    }
    return null;
  }

  private normalizeIdList(values: readonly unknown[]): string[] {
    const ids = values.map((v) => this.toId(v)).filter((id): id is string => id !== null);
    return Array.from(new Set(ids));
  }

  private matchByQuery<T>(
    items: T[],
    query: string,
    fields: (item: T) => Array<string | null | undefined>,
  ): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) =>
      fields(item).some((value) => value?.toLowerCase().includes(normalizedQuery)),
    );
  }
}
