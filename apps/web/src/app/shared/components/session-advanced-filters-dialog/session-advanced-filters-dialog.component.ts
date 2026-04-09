import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MultiSelectModule } from 'primeng/multiselect';
import type { Campus } from '@core/campuses.service';
import type { Course } from '@core/courses.service';
import type { Staff } from '@core/staff.service';
import type { Student } from '@core/students.service';
import { ImeFilterInputComponent } from '@shared/components/ime-filter-input/ime-filter-input.component';

const SESSION_STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '正常', value: 'scheduled' },
  { label: '已完成', value: 'completed' },
  { label: '已停課', value: 'cancelled' },
];

const DEFAULT_STATUSES = ['scheduled', 'completed'];

export interface SessionAdvancedFilterClassOption {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  readonly campusId: string;
}

export interface SessionAdvancedFiltersDialogData {
  readonly mode: 'sessions' | 'attendance';
  readonly campuses: Campus[];
  readonly courses: Course[];
  readonly classes: SessionAdvancedFilterClassOption[];
  readonly students?: Student[];
  readonly teachers?: Staff[];
  readonly selectedCampusIds?: string[];
  readonly selectedCampusId?: string | null;
  readonly selectedCourseIds: string[];
  readonly selectedClassIds: string[];
  readonly selectedStudentIds?: string[];
  readonly selectedTeacherIds?: string[];
  readonly selectedStatuses?: string[];
}

export interface SessionAdvancedFiltersDialogResult {
  readonly courseIds: string[];
  readonly classIds: string[];
  readonly studentIds: string[];
  readonly teacherIds: string[];
  readonly statuses: string[];
}

interface DialogClassDisplayOption extends SessionAdvancedFilterClassOption {
  readonly courseName: string | null;
  readonly campusName: string | null;
}

type TeacherOption = Pick<Staff, 'id' | 'displayName' | 'campusIds' | 'subjectIds' | 'subjectNames'>;

@Component({
  selector: 'app-session-advanced-filters-dialog',
  imports: [FormsModule, ButtonModule, MultiSelectModule, ImeFilterInputComponent],
  templateUrl: './session-advanced-filters-dialog.component.html',
  styleUrl: './session-advanced-filters-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionAdvancedFiltersDialogComponent {
  private readonly config = inject(DynamicDialogConfig<SessionAdvancedFiltersDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly mode = signal<'sessions' | 'attendance'>('attendance');
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly courses = signal<Course[]>([]);
  protected readonly classes = signal<SessionAdvancedFilterClassOption[]>([]);
  protected readonly students = signal<Student[]>([]);
  protected readonly teachers = signal<Staff[]>([]);

  protected readonly selectedCampusIds = signal<string[]>([]);
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedCourseIds = signal<string[]>([]);
  protected readonly selectedClassIds = signal<string[]>([]);
  protected readonly selectedStudentIds = signal<string[]>([]);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedStatuses = signal<string[]>([...DEFAULT_STATUSES]);

  protected readonly courseFilterQuery = signal('');
  protected readonly classFilterQuery = signal('');
  protected readonly teacherFilterQuery = signal('');

  protected readonly statusOptions = SESSION_STATUS_OPTIONS;
  protected readonly isAttendanceMode = computed(() => this.mode() === 'attendance');
  protected readonly isSessionsMode = computed(() => this.mode() === 'sessions');
  protected readonly modeLabel = computed(() =>
    this.isAttendanceMode() ? '出勤紀錄篩選' : '課堂管理篩選',
  );

  protected readonly campusScopeIds = computed(() => {
    if (this.isAttendanceMode()) {
      const campusId = this.selectedCampusId();
      return campusId ? [campusId] : [];
    }

    return this.selectedCampusIds();
  });
  protected readonly scopeSummary = computed(() => {
    if (this.isAttendanceMode()) {
      const campusId = this.selectedCampusId();
      if (!campusId) {
        return '尚未選擇分校';
      }

      return this.campusNameById().get(campusId) ?? '目前分校';
    }

    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) {
      return '全部分校';
    }

    if (campusIds.length === 1) {
      return this.campusNameById().get(campusIds[0] ?? '') ?? '1 個分校';
    }

    return `${campusIds.length} 個分校`;
  });
  protected readonly appliedFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseIds().length > 0) count++;
    if (this.selectedClassIds().length > 0) count++;
    if (this.selectedStudentIds().length > 0) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.selectedStatuses().length !== DEFAULT_STATUSES.length) count++;
    return count;
  });

  protected readonly campusNameById = computed(
    () => new Map(this.campuses().map((campus) => [campus.id, campus.name])),
  );
  protected readonly courseNameById = computed(
    () => new Map(this.courses().map((course) => [course.id, course.name])),
  );

  protected readonly filteredCourseOptions = computed(() =>
    matchByQuery(this.getScopedCourses(), this.courseFilterQuery(), (course) => [
      course.name,
      course.campusName ?? this.campusNameById().get(course.campusId),
    ]),
  );

  protected readonly showClassFilter = computed(() => this.selectedCourseIds().length > 0);

  protected readonly filteredClassOptions = computed<DialogClassDisplayOption[]>(() => {
    const scopedClasses = this.classes()
      .filter((classOption) => this.selectedCourseIds().includes(classOption.courseId))
      .filter((classOption) => {
        const campusScopeIds = this.campusScopeIds();
        return campusScopeIds.length === 0 || campusScopeIds.includes(classOption.campusId);
      })
      .map((classOption) => ({
        ...classOption,
        courseName: this.courseNameById().get(classOption.courseId) ?? null,
        campusName: this.campusNameById().get(classOption.campusId) ?? null,
      }));

    return matchByQuery(scopedClasses, this.classFilterQuery(), (classOption) => [
      classOption.name,
      classOption.courseName,
      classOption.campusName,
    ]);
  });

  protected readonly teacherScopeHint = computed(() => {
    const campusScopeIds = this.campusScopeIds();
    if (campusScopeIds.length === 0) {
      return '顯示全部分校的任課老師。';
    }
    const names = campusScopeIds
      .map((id) => this.campusNameById().get(id))
      .filter((name): name is string => !!name);
    if (names.length === 0) return '搜尋範圍限在目前所選分校。';
    return `搜尋範圍限在 ${names.join('、')}。`;
  });

  protected readonly filteredTeacherOptions = computed<TeacherOption[]>(() => {
    const scopedTeachers = this.teachers()
      .filter((teacher) => {
        const campusScopeIds = this.campusScopeIds();
        return (
          campusScopeIds.length === 0 ||
          teacher.campusIds.some((campusId) => campusScopeIds.includes(campusId))
        );
      })
      .filter((teacher) => {
        if (this.selectedCourseIds().length === 0) {
          return true;
        }

        const subjectIds = new Set(
          this.courses()
            .filter((course) => this.selectedCourseIds().includes(course.id))
            .map((course) => course.subjectId),
        );

        return teacher.subjectIds.some((subjectId) => subjectIds.has(subjectId));
      });

    const matched = matchByQuery(scopedTeachers, this.teacherFilterQuery(), (teacher) => [
      teacher.displayName,
      ...teacher.subjectNames,
      ...teacher.campusIds
        .map((campusId) => this.campusNameById().get(campusId))
        .filter((campusName): campusName is string => !!campusName),
    ]);

    if (this.isSessionsMode()) {
      const unassigned: TeacherOption = {
        id: '__unassigned__',
        displayName: '未指派',
        campusIds: [],
        subjectIds: [],
        subjectNames: [],
      };
      return [unassigned, ...matched];
    }

    return matched;
  });

  constructor() {
    const data = this.config.data;
    if (!data) {
      return;
    }

    this.mode.set(data.mode);
    this.campuses.set(data.campuses);
    this.courses.set(data.courses);
    this.classes.set(data.classes);
    this.students.set(data.students ?? []);
    this.teachers.set(data.teachers ?? []);
    this.selectedCampusIds.set([...(data.selectedCampusIds ?? [])]);
    this.selectedCampusId.set(data.selectedCampusId ?? null);
    this.selectedCourseIds.set([...data.selectedCourseIds]);
    this.selectedClassIds.set([...data.selectedClassIds]);
    this.selectedStudentIds.set([...(data.selectedStudentIds ?? [])]);
    this.selectedTeacherIds.set([...(data.selectedTeacherIds ?? [])]);
    this.selectedStatuses.set([...(data.selectedStatuses ?? DEFAULT_STATUSES)]);
  }

  protected clearFilters(): void {
    this.selectedCourseIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedStatuses.set([...DEFAULT_STATUSES]);
  }

  protected apply(): void {
    const result: SessionAdvancedFiltersDialogResult = {
      courseIds: this.selectedCourseIds(),
      classIds: this.selectedClassIds(),
      studentIds: this.selectedStudentIds(),
      teacherIds: this.selectedTeacherIds(),
      statuses: this.selectedStatuses(),
    };

    this.ref.close(result);
  }

  protected getStudentOptionMeta(student: Student): string | null {
    const gradeMap: Record<string, string> = {
      P1: '小一', P2: '小二', P3: '小三', P4: '小四', P5: '小五', P6: '小六',
      J1: '國一', J2: '國二', J3: '國三',
      S1: '高一', S2: '高二', S3: '高三',
    };
    const parts = [student.school, gradeMap[student.grade]].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  protected getTeacherOptionMeta(teacher: TeacherOption): string | null {
    const subjects = teacher.subjectNames.join('、');
    const campuses = teacher.campusIds
      .map((id) => this.campusNameById().get(id))
      .filter((name): name is string => !!name)
      .join('、');
    const parts = [subjects, campuses].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  protected getClassMetaLabel(classOption: DialogClassDisplayOption): string | null {
    const parts = [classOption.courseName, classOption.campusName].filter(
      (value): value is string => !!value,
    );

    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private getScopedCourses(): Course[] {
    const campusScopeIds = this.campusScopeIds();
    if (campusScopeIds.length === 0) {
      return this.courses();
    }

    return this.courses().filter((course) => campusScopeIds.includes(course.campusId));
  }

  protected buildMultiSelectFilterEvent(query: string): Event {
    return {
      target: { value: query },
    } as unknown as Event;
  }
}

function matchByQuery<T>(
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
