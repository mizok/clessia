import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ParentsService, type ParentDetail } from '@core/parents.service';
import { StudentsService } from '@core/students.service';
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

  const parentsServiceMock = {
    get: vi.fn(() => of({ data: parentDetail })),
    // 帶上參數型別 —— 不然 `mock.calls` 是空 tuple，下面那條斷言取不到 `[1]`
    update: vi.fn((_id: string, _input: { studentIds?: string[] }) => of({ data: {} })),
  };

  const studentsServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };

  beforeEach(async () => {
    enrollmentsServiceMock.create.mockClear();
    parentsServiceMock.update.mockClear();
    parentsServiceMock.get.mockClear();

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
          useValue: parentsServiceMock,
        },
        {
          provide: StudentsService,
          useValue: studentsServiceMock,
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
        enroll: (
          student: ParentDetail['students'][number],
          cls: { id: string; name: string },
          force?: boolean,
        ) => void;
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
        enroll: (
          student: ParentDetail['students'][number],
          cls: { id: string; name: string },
          force?: boolean,
        ) => void;
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

  /**
   * **#641 這支唯一真正危險的地方。**
   *
   * `studentIds` 是**全量替換** —— 後端 `parents.ts:632` 先
   * `delete().eq('parent_id', id)` 再 insert。所以送出一份不完整的清單，
   * 就是**靜靜解除既有關聯**，而那個失效跟「本來就沒綁」在畫面上一模一樣：
   * 不會有錯誤、不會有紅燈，只有家長少了一個小孩。
   *
   * 這一條釘住「送出的是現有的全部 ＋ 新的那一個」，**不是只送新的那一個**。
   */
  describe('綁定既有學生時的全量替換語意', () => {
    const bind = (student: { id: string; name: string }) =>
      (
        fixture.componentInstance as unknown as {
          bindExistingStudent: (s: unknown) => void;
        }
      ).bindExistingStudent(student);

    it('送出「現有的全部 + 新的那一個」，不是只送新的', () => {
      bind({ id: 'student-2', name: '王小華' });

      expect(parentsServiceMock.update).toHaveBeenCalledWith('parent-1', {
        studentIds: ['student-1', 'student-2'],
      });
    });

    it('陷阱：既有的那一個一定要在清單裡 —— 少了它就是解除關聯', () => {
      bind({ id: 'student-2', name: '王小華' });

      const sent = parentsServiceMock.update.mock.calls[0][1];
      expect(sent.studentIds).toContain('student-1');
      expect(sent.studentIds).not.toEqual(['student-2']);
    });

    it('已經綁過的不重送，避免無謂的全量替換', () => {
      bind({ id: 'student-1', name: '王小明' });

      expect(parentsServiceMock.update).not.toHaveBeenCalled();
    });
  });
});
