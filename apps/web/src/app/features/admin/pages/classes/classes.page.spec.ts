import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { ClassesPage } from './classes.page';
import { CoursesService } from '@core/courses.service';
import { ClassesService, type Class } from '@core/classes.service';
import { CampusesService } from '@core/campuses.service';
import { SubjectsService } from '@core/subjects.service';
import { StaffService } from '@core/staff.service';
import { SessionsService } from '@core/sessions.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { BrowserStateService } from '@core/browser-state.service';

describe('ClassesPage', () => {
  let fixture: ComponentFixture<ClassesPage>;
  let component: ClassesPage;
  let router: Router;

  const coursesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
    delete: vi.fn(),
  };
  const classesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };
  const campusesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };
  const subjectsServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };
  const staffServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };
  const sessionsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'session-1',
            classId: 'class-1',
            className: '數學 A 班',
            courseId: 'course-1',
            courseName: '數學',
            campusId: 'campus-1',
            campusName: '本校',
            sessionDate: '2026-02-10',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: null,
            teacherName: null,
            status: 'scheduled',
            assignmentStatus: 'unassigned',
            hasChanges: false,
          },
          {
            id: 'session-2',
            classId: 'class-1',
            className: '數學 A 班',
            courseId: 'course-1',
            courseName: '數學',
            campusId: 'campus-1',
            campusName: '本校',
            sessionDate: '2026-06-18',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: null,
            teacherName: null,
            status: 'scheduled',
            assignmentStatus: 'unassigned',
            hasChanges: false,
          },
        ],
      }),
    ),
  };

  beforeEach(async () => {
    sessionsServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [ClassesPage],
      providers: [
        provideRouter([]),
        { provide: CoursesService, useValue: coursesServiceMock },
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: CampusesService, useValue: campusesServiceMock },
        { provide: SubjectsService, useValue: subjectsServiceMock },
        { provide: StaffService, useValue: staffServiceMock },
        { provide: SessionsService, useValue: sessionsServiceMock },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        { provide: BrowserStateService, useValue: { isMobile: () => false } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ConfirmationService, useValue: { confirm: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassesPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: '課程管理',
      relativePath: 'classes',
      absolutePath: '/admin/classes',
      role: undefined,
      icon: 'pi-users',
      showInMenu: true,
    });
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  it('navigates to calendar list with first and last session dates for the class', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (component as unknown as { navigateToCalendarList: (target: Class) => void }).navigateToCalendarList(
      cls,
    );

    expect(sessionsServiceMock.list).toHaveBeenCalledWith({
      classId: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/admin/calendar'], {
      queryParams: {
        view: 'list',
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        from: '2026-02-10',
        to: '2026-06-18',
      },
    });
  });

  it('falls back to navigation without date range when session lookup fails', () => {
    sessionsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('lookup failed')));
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (component as unknown as { navigateToCalendarList: (target: Class) => void }).navigateToCalendarList(
      cls,
    );

    expect(navigateSpy).toHaveBeenCalledWith(['/admin/calendar'], {
      queryParams: {
        view: 'list',
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
      },
    });
  });
});
