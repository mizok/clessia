import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ParentsService, type ParentDetail } from '@core/parents.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { ParentDetailDialogComponent } from './parent-detail-dialog.component';

describe('ParentDetailDialogComponent', () => {
  let fixture: ComponentFixture<ParentDetailDialogComponent>;

  const parentDetail: ParentDetail = {
    id: 'parent-1',
    userId: 'user-1',
    orgId: 'org-1',
    name: '王媽媽',
    phone: '0912345678',
    email: 'mom@example.com',
    loginAccount: 'mom@example.com',
    status: 'active',
    studentCount: 1,
    studentNames: ['王小明'],
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    students: [
      {
        id: 'student-1',
        name: '王小明',
        grade: 'P5',
        relation: 'mother',
        isPrimary: true,
      },
    ],
  };

  const enrollmentsServiceMock = {
    create: vi.fn(() => of({ data: { id: 'enrollment-1' } })),
  };

  beforeEach(async () => {
    enrollmentsServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [ParentDetailDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              parentId: 'parent-1',
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: ParentsService,
          useValue: {
            get: vi.fn(() => of({ data: parentDetail })),
          },
        },
        {
          provide: EnrollmentsService,
          useValue: enrollmentsServiceMock,
        },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: vi.fn(() => null),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParentDetailDialogComponent);
    fixture.detectChanges();
  });

  it('renders linked students and enrollment action', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('王小明');
    expect(text).toContain('小五');
    expect(text).toContain('報名班級');
  });

  it('shows conflict prompt when enrollment API returns SCHEDULE_CONFLICT', () => {
    enrollmentsServiceMock.create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'SCHEDULE_CONFLICT',
          warnings: [
            {
              studentId: 'student-1',
              conflictingClassId: 'class-conflict',
              conflictingClassName: '英文 A',
              conflictingCourseName: '英文',
              weekday: 5,
              startTime: '18:00:00',
              endTime: '20:00:00',
            },
          ],
        },
      })),
    );

    (
      fixture.componentInstance as unknown as {
        enroll: (student: ParentDetail['students'][number], cls: { id: string; name: string }, force?: boolean) => void;
      }
    ).enroll(parentDetail.students[0], { id: 'class-1', name: '數學 B' });

    expect(fixture.componentInstance['conflictPrompt']()).toEqual({
      student: parentDetail.students[0],
      cls: { id: 'class-1', name: '數學 B' },
      warnings: [
        expect.objectContaining({
          conflictingClassId: 'class-conflict',
          weekday: 5,
        }),
      ],
    });
  });

  it('shows quota notice when enrollment API returns OVER_QUOTA', () => {
    enrollmentsServiceMock.create.mockReturnValueOnce(
      throwError(() => ({
        error: {
          code: 'OVER_QUOTA',
        },
      })),
    );

    (
      fixture.componentInstance as unknown as {
        enroll: (student: ParentDetail['students'][number], cls: { id: string; name: string }, force?: boolean) => void;
      }
    ).enroll(parentDetail.students[0], { id: 'class-1', name: '數學 B' });

    expect(fixture.componentInstance['notice']()).toEqual({
      severity: 'error',
      summary: '班級人數已達上限',
      detail: '無法加入，請聯絡管理員調整上限或改選其他班級',
    });
  });

  it('retries with skipConflictCheck when confirming conflict enroll', () => {
    fixture.componentInstance['conflictPrompt'].set({
      student: parentDetail.students[0],
      cls: { id: 'class-1', name: '數學 B' } as never,
      warnings: [],
    });

    fixture.componentInstance['confirmConflictEnroll']();

    expect(enrollmentsServiceMock.create).toHaveBeenLastCalledWith({
      classId: 'class-1',
      studentId: 'student-1',
      skipConflictCheck: true,
    });
  });
});
