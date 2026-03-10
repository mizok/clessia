import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Course } from '@core/courses.service';
import type { Staff } from '@core/staff.service';

import { SessionFiltersComponent } from './session-filters.component';

describe('SessionFiltersComponent', () => {
  let component: SessionFiltersComponent;
  let fixture: ComponentFixture<SessionFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionFiltersComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SessionFiltersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter teachers by selected course subject', () => {
    fixture.componentRef.setInput('selectedCourseId', 'course-math');
    fixture.componentRef.setInput('availableCourses', [
      buildCourse({ id: 'course-math', subjectId: 'subject-math' }),
      buildCourse({ id: 'course-english', subjectId: 'subject-english' }),
    ]);
    fixture.componentRef.setInput('availableTeachers', [
      buildTeacher({ id: 'teacher-1', subjectIds: ['subject-math'] }),
      buildTeacher({ id: 'teacher-2', subjectIds: ['subject-english'] }),
    ]);
    fixture.detectChanges();

    const teachers = (component as unknown as { filteredTeachers: () => Staff[] }).filteredTeachers();
    expect(teachers.map((teacher) => teacher.id)).toEqual(['teacher-1']);
  });

  it('should emit normalized course id from select object', () => {
    let emitted: string | null = 'pending';
    component.courseChange.subscribe((value) => {
      emitted = value;
    });

    (
      component as unknown as {
        onCourseSelectChange: (value: string | Course | null) => void;
      }
    ).onCourseSelectChange({
      ...buildCourse({ id: 'course-1' }),
    });

    expect(emitted).toBe('course-1');
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
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    campusIds: ['campus-1'],
    roles: ['teacher'],
    permissions: [],
    ...overrides,
  };
}
