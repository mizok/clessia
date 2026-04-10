import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { DialogService } from 'primeng/dynamicdialog';

import { StudentDetailPage } from './student-detail.page';
import { StudentsService } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

describe('StudentDetailPage', () => {
  let fixture: ComponentFixture<StudentDetailPage>;

  const seedStudentId = '61000000-0000-0000-0000-000000000001';
  const paramMap$ = new BehaviorSubject(convertToParamMap({ id: seedStudentId }));

  const studentsServiceMock = {
    get: vi.fn(() =>
      of({
        data: {
          id: seedStudentId,
          orgId: 'org-1',
          name: '出勤測試學生01',
          grade: 'J1',
          school: '測試國中',
          birthday: null,
          gender: null,
          phone: null,
          email: null,
          address: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          notes: null,
          isActive: true,
          parentNames: [],
          campusNames: [],
          hasEnrollments: true,
          createdAt: '2026-04-01T00:00:00Z',
          updatedAt: '2026-04-01T00:00:00Z',
          parents: [],
        },
      }),
    ),
  };

  const enrollmentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
      }),
    ),
    create: vi.fn(() =>
      of({
        data: {
          id: 'enrollment-1',
          classId: 'class-1',
          studentId: seedStudentId,
        },
      }),
    ),
  };

  beforeEach(async () => {
    studentsServiceMock.get.mockClear();
    enrollmentsServiceMock.list.mockClear();
    enrollmentsServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [StudentDetailPage],
      providers: [
        provideRouter([]),
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ id: seedStudentId }) },
            paramMap: paramMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads student and enrollments from route params', () => {
    expect(studentsServiceMock.get).toHaveBeenCalledWith(seedStudentId);
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      studentId: seedStudentId,
      pageSize: 50,
    });
  });

  it('shows conflict prompt when enrollment API returns SCHEDULE_CONFLICT', () => {
    enrollmentsServiceMock.create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              studentId: seedStudentId,
              conflictingClassId: 'class-conflict',
              conflictingClassName: '英文 A',
              conflictingCourseName: '英文',
              weekday: 3,
              startTime: '19:00:00',
              endTime: '21:00:00',
            },
          ],
        },
      })),
    );

    (
      fixture.componentInstance as unknown as {
        addToClass: (cls: { id: string; name: string }, force?: boolean) => void;
      }
    ).addToClass({ id: 'class-1', name: '數學 B' });

    expect(fixture.componentInstance['conflictPrompt']()).toEqual({
      cls: { id: 'class-1', name: '數學 B' },
      warnings: [
        expect.objectContaining({
          conflictingClassId: 'class-conflict',
          conflictingClassName: '英文 A',
        }),
      ],
    });
    expect(fixture.componentInstance['notice']()).toBeNull();
  });

  it('shows warning notice when enrollment API returns ALREADY_ENROLLED', () => {
    enrollmentsServiceMock.create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'ALREADY_ENROLLED',
        },
      })),
    );

    (
      fixture.componentInstance as unknown as {
        addToClass: (cls: { id: string; name: string }, force?: boolean) => void;
      }
    ).addToClass({ id: 'class-1', name: '數學 B' });

    expect(fixture.componentInstance['notice']()).toEqual({
      severity: 'warning',
      summary: '已經在此班',
      detail: '「出勤測試學生01」已經是「數學 B」的成員',
    });
  });

  it('retries with skipConflictCheck when confirming conflict enroll', () => {
    fixture.componentInstance['conflictPrompt'].set({
      cls: { id: 'class-1', name: '數學 B' } as never,
      warnings: [],
    });

    fixture.componentInstance['confirmConflictEnroll']();

    expect(enrollmentsServiceMock.create).toHaveBeenLastCalledWith({
      classId: 'class-1',
      studentId: seedStudentId,
      skipConflictCheck: true,
    });
  });
});
