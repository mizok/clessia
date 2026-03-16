import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Course } from '@core/courses.service';
import type { Staff } from '@core/staff.service';

import { SessionFiltersComponent } from './session-filters.component';

describe('SessionFiltersComponent', () => {
  let component: SessionFiltersComponent;
  let fixture: ComponentFixture<SessionFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionFiltersComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionFiltersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter teachers by selected course subject', () => {
    fixture.componentRef.setInput('selectedCourseIds', ['course-math']);
    fixture.componentRef.setInput('availableCourses', [
      buildCourse({ id: 'course-math', subjectId: 'subject-math' }),
      buildCourse({ id: 'course-english', subjectId: 'subject-english' }),
    ]);
    fixture.componentRef.setInput('availableTeachers', [
      buildTeacher({ id: 'teacher-1', subjectIds: ['subject-math'] }),
      buildTeacher({ id: 'teacher-2', subjectIds: ['subject-english'] }),
    ]);
    fixture.detectChanges();

    const teachers = (
      component as unknown as { filteredTeachers: () => Staff[] }
    ).filteredTeachers();
    expect(teachers.map((teacher) => teacher.id)).toEqual(['teacher-1']);
  });

  it('should emit normalized course ids from multi-select values', () => {
    let emitted: string[] = [];
    component.courseIdsChange.subscribe((value: string[]) => {
      emitted = value;
    });

    (
      component as unknown as {
        onCourseMultiChange: (values: readonly (string | Course)[]) => void;
      }
    ).onCourseMultiChange([
      'course-1',
      buildCourse({ id: 'course-2' }),
      buildCourse({ id: 'course-1' }),
    ]);

    expect(emitted).toEqual(['course-1', 'course-2']);
  });

  it('should emit normalized teacher ids for multi-select values', () => {
    let emitted: string[] = [];
    component.teacherIdsChange.subscribe((value) => {
      emitted = value;
    });

    (
      component as unknown as {
        onTeacherMultiChange: (values: readonly (string | Staff)[]) => void;
      }
    ).onTeacherMultiChange([
      'teacher-1',
      buildTeacher({ id: 'teacher-2' }),
      buildTeacher({ id: 'teacher-1' }),
    ]);

    expect(emitted).toEqual(['teacher-1', 'teacher-2']);
  });

  it('should join teacher subject names for display', () => {
    const subjectLabel = (
      component as unknown as {
        getTeacherSubjectLabel: (teacher: { readonly subjectNames?: string[] }) => string | null;
      }
    ).getTeacherSubjectLabel(buildTeacher({ subjectNames: ['國文', '英文'] }));

    expect(subjectLabel).toBe('國文、英文');
  });

  it('should join class course and campus label for display', () => {
    const metaLabel = (
      component as unknown as {
        getClassMetaLabel: (classOption: {
          readonly courseName: string | null;
          readonly campusName: string | null;
        }) => string | null;
      }
    ).getClassMetaLabel({
      courseName: '國文 七年級基礎先修班',
      campusName: '示範分校01',
    });

    expect(metaLabel).toBe('國文 七年級基礎先修班 · 示範分校01');
  });

  it('should emit normalized class ids from multi-select values', () => {
    let emitted: string[] = [];
    component.classIdsChange.subscribe((value: string[]) => {
      emitted = value;
    });

    (
      component as unknown as {
        onClassMultiChange: (values: readonly (string | { readonly id: string })[]) => void;
      }
    ).onClassMultiChange(['class-1', { id: 'class-2' }, { id: 'class-1' }]);

    expect(emitted).toEqual(['class-1', 'class-2']);
  });
});

function buildCourse(overrides: Partial<Course>): Course {
  return {
    id: 'course-default',
    orgId: 'org-1',
    campusId: 'campus-1',
    name: 'Course',
    subjectId: 'subject-default',
    subjectName: 'Subject',
    description: null,
    isActive: true,
    gradeLevels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTeacher(overrides: Partial<Staff>): Staff {
  return {
    id: 'teacher-default',
    userId: 'user-1',
    orgId: 'org-1',
    displayName: 'Teacher',
    phone: null,
    email: 'teacher@example.com',
    birthday: null,
    notes: null,
    subjectIds: [],
    subjectNames: [],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    campusIds: ['campus-1'],
    roles: ['teacher'],
    permissions: [],
    ...overrides,
  };
}
