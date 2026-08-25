import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MultiSelect } from 'primeng/multiselect';
import type { Campus } from '@core/campuses.service';
import type { Course } from '@core/courses.service';
import type { Staff } from '@core/staff.service';
import type { Student } from '@core/students.service';
import {
  SessionAdvancedFiltersDialogComponent,
  type SessionAdvancedFiltersDialogData,
} from './session-advanced-filters-dialog.component';

describe('SessionAdvancedFiltersDialogComponent', () => {
  let component: SessionAdvancedFiltersDialogComponent;
  let fixture: ComponentFixture<SessionAdvancedFiltersDialogComponent>;
  let dialogData: SessionAdvancedFiltersDialogData;

  const dialogRefMock = {
    close: vi.fn(),
  };

  beforeEach(async () => {
    dialogRefMock.close.mockClear();
    dialogData = buildDialogData({ mode: 'attendance' });

    await TestBed.configureTestingModule({
      imports: [SessionAdvancedFiltersDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            get data() {
              return dialogData;
            },
          },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();
  });

  function createComponent() {
    fixture = TestBed.createComponent(SessionAdvancedFiltersDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  it('filters course options with fuzzy search inside current campus scope', () => {
    dialogData = buildDialogData({
      mode: 'attendance',
      selectedCampusId: 'campus-1',
    });

    createComponent();

    (
      component as unknown as { courseFilterQuery: { set: (value: string) => void } }
    ).courseFilterQuery.set('英');

    const filteredCourses = (
      component as unknown as {
        filteredCourseOptions: () => Course[];
      }
    ).filteredCourseOptions();

    expect(filteredCourses.map((course) => course.id)).toEqual(['course-2']);
  });

  it('does not render class filter before any course is selected', () => {
    createComponent();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.session-advanced-filters-dialog__label'),
    ).map((element) => (element as HTMLElement).textContent?.trim());

    expect(labels).not.toContain('班級');
  });

  it('renders class filter after selecting at least one course', () => {
    createComponent();

    (
      component as unknown as {
        selectedCourseIds: { set: (value: string[]) => void };
      }
    ).selectedCourseIds.set(['course-1']);
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.session-advanced-filters-dialog__label'),
    ).map((element) => (element as HTMLElement).textContent?.trim());

    expect(labels).toContain('班級');
  });

  it('shows student filter in attendance mode and hides teacher/status filters', () => {
    dialogData = buildDialogData({ mode: 'attendance' });

    createComponent();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('學生');
    expect(text).not.toContain('老師');
    expect(text).not.toContain('課堂狀態');
  });

  it('student filter only matches student fields, not parent names', () => {
    dialogData = buildDialogData({ mode: 'attendance' });

    createComponent();

    const multiSelects = fixture.debugElement.queryAll(By.directive(MultiSelect));
    const studentMultiSelect = multiSelects[1]?.componentInstance as MultiSelect | undefined;

    expect(studentMultiSelect?.filterBy).toBe('name,school');
  });

  it('shows teacher/status filters in sessions mode and keeps student filter available', () => {
    dialogData = buildDialogData({ mode: 'sessions' });

    createComponent();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('學生');
    expect(text).toContain('老師');
    expect(text).toContain('課堂狀態');
  });
});

function buildDialogData(
  overrides: Partial<SessionAdvancedFiltersDialogData>,
): SessionAdvancedFiltersDialogData {
  return {
    mode: 'attendance',
    campuses: [buildCampus('campus-1', '中正分校'), buildCampus('campus-2', '大安分校')],
    courses: [
      buildCourse({
        id: 'course-1',
        name: '數學先修',
        campusId: 'campus-1',
        campusName: '中正分校',
        subjectId: 'subject-math',
      }),
      buildCourse({
        id: 'course-2',
        name: '英文進階',
        campusId: 'campus-1',
        campusName: '中正分校',
        subjectId: 'subject-english',
      }),
      buildCourse({
        id: 'course-3',
        name: '自然實驗',
        campusId: 'campus-2',
        campusName: '大安分校',
        subjectId: 'subject-science',
      }),
    ],
    classes: [
      { id: 'class-1', name: '數學 A', courseId: 'course-1', campusId: 'campus-1' },
      { id: 'class-2', name: '英文 B', courseId: 'course-2', campusId: 'campus-1' },
      { id: 'class-3', name: '自然 C', courseId: 'course-3', campusId: 'campus-2' },
    ],
    students: [buildStudent()],
    teachers: [buildTeacher()],
    selectedCampusIds: ['campus-1'],
    selectedCampusId: 'campus-1',
    selectedCourseIds: [],
    selectedClassIds: [],
    selectedStudentIds: [],
    selectedTeacherIds: [],
    selectedStatuses: ['scheduled', 'completed'],
    ...overrides,
  };
}

function buildCampus(id: string, name: string): Campus {
  return {
    id,
    orgId: 'org-1',
    name,
    address: null,
    phone: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function buildCourse(overrides: Partial<Course>): Course {
  return {
    id: 'course-default',
    orgId: 'org-1',
    campusId: 'campus-1',
    campusName: '中正分校',
    name: '預設課程',
    subjectId: 'subject-default',
    subjectName: '預設科目',
    description: null,
    isActive: true,
    gradeLevels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildStudent(): Student {
  return {
    id: 'student-1',
    orgId: 'org-1',
    name: '王小明',
    grade: 'J1',
    school: { id: 'school-1', name: '測試國中', shortName: null },
    birthday: null,
    gender: null,
    phone: null,
    email: null,
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    notes: null,
    isActive: true,
    parentNames: ['王爸爸'],
    campusNames: ['中正分校'],
    classNames: [],
    hasEnrollments: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function buildTeacher(): Staff {
  return {
    id: 'teacher-1',
    userId: 'user-1',
    orgId: 'org-1',
    displayName: '陳老師',
    phone: null,
    email: 'teacher@example.com',
    birthday: null,
    notes: null,
    subjectIds: ['subject-math'],
    subjectNames: ['數學'],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    campusIds: ['campus-1'],
    roles: ['teacher'],
    permissions: [],
  };
}
