import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';

import { StudentPickerDialogComponent } from './student-picker-dialog.component';
import { StudentsService } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';

describe('StudentPickerDialogComponent', () => {
  let fixture: ComponentFixture<StudentPickerDialogComponent>;

  const studentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'student-1',
            orgId: 'org-1',
            name: '王小明',
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
            hasEnrollments: false,
            createdAt: '2026-04-01T00:00:00Z',
            updatedAt: '2026-04-01T00:00:00Z',
          },
          {
            id: 'student-2',
            orgId: 'org-1',
            name: '李小華',
            grade: 'J2',
            school: '示範國中',
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
            hasEnrollments: false,
            createdAt: '2026-04-01T00:00:00Z',
            updatedAt: '2026-04-01T00:00:00Z',
          },
        ],
        meta: { total: 2, page: 1, pageSize: 8, totalPages: 1 },
        summary: { total: 2, activeCount: 2 },
      }),
    ),
  };

  const enrollmentsServiceMock = {
    batchCreate: vi.fn(() =>
      of({
        results: [{ studentId: 'student-1', status: 'enrolled', enrollmentId: 'enrollment-1' }],
      }),
    ),
  };

  const dialogRefMock = {
    close: vi.fn(),
  };

  beforeEach(async () => {
    studentsServiceMock.list.mockClear();
    enrollmentsServiceMock.batchCreate.mockClear();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [StudentPickerDialogComponent],
      providers: [
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              classId: 'class-1',
              existingStudentIds: [],
              maxStudents: 10,
              currentActiveCount: 2,
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StudentPickerDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows conflict warnings when batchCreate returns SCHEDULE_CONFLICT', () => {
    fixture.componentInstance['selectedIds'].set(new Set(['student-1']));
    enrollmentsServiceMock.batchCreate.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              studentId: 'student-1',
              conflictingClassId: 'class-conflict',
              conflictingClassName: '英文 A',
              conflictingCourseName: '英文',
              weekday: 2,
              startTime: '18:00:00',
              endTime: '20:00:00',
            },
          ],
        },
      })),
    );

    fixture.componentInstance['confirm']();

    expect(fixture.componentInstance['conflictWarnings']()).toEqual([
      expect.objectContaining({
        studentId: 'student-1',
        conflictingClassId: 'class-conflict',
      }),
    ]);
    expect(fixture.componentInstance['confirmError']()).toBeNull();
  });

  it('retries batchCreate with skipConflictCheck when forcing confirm', () => {
    fixture.componentInstance['selectedIds'].set(new Set(['student-1', 'student-2']));

    fixture.componentInstance['confirmForce']();

    expect(enrollmentsServiceMock.batchCreate).toHaveBeenLastCalledWith({
      classId: 'class-1',
      studentIds: ['student-1', 'student-2'],
      skipConflictCheck: true,
    });
  });

  it('shows quota message when batchCreate returns OVER_QUOTA', () => {
    fixture.componentInstance['selectedIds'].set(new Set(['student-1']));
    enrollmentsServiceMock.batchCreate.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'OVER_QUOTA',
        },
      })),
    );

    fixture.componentInstance['confirm']();

    expect(fixture.componentInstance['confirmError']()).toBe('超過班級人數上限，請減少加入人數');
  });
});
