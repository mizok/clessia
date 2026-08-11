import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { AcademyExamsService, type AcademyExam } from '@core/academy-exams.service';
import { ScoresService, type ClassExamStats } from '@core/scores.service';

import { ClassScoresDialogComponent } from './class-scores-dialog.component';

describe('ClassScoresDialogComponent', () => {
  let fixture: ComponentFixture<ClassScoresDialogComponent>;
  let component: ClassScoresDialogComponent;

  const listMock = vi.fn();
  const getClassExamStatsMock = vi.fn();
  const navigateMock = vi.fn();
  const closeMock = vi.fn();

  const baseClass = {
    id: 'class-1',
    name: 'A班',
    maxStudents: 20,
    gradeLevels: ['J1'],
    courseId: 'course-1',
    campusId: 'campus-1',
    orgId: 'org-1',
    nextClassId: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  };

  const exam: AcademyExam = {
    id: 'exam-1',
    name: '第一次段考',
    examType: 'quiz',
    status: 'active',
    examDate: '2026-04-01',
    totalScore: 100,
    scopeNote: null,
    campusId: 'campus-1',
    subjectId: null,
    subjectName: null,
    classCount: 1,
    scoreCount: 0,
    createdAt: '',
    updatedAt: '',
  };

  const stats: ClassExamStats = {
    examId: 'exam-1',
    examName: '第一次段考',
    className: 'A班',
    summary: {
      averageScore: 80,
      highestScore: 95,
      lowestScore: 62,
      absentCount: 0,
      recordedCount: 1,
    },
    scores: [
      {
        studentId: 'stu-1',
        studentName: '王小明',
        score: 80,
        status: 'scored',
        notes: null,
      },
    ],
  };

  beforeEach(async () => {
    listMock.mockReset();
    getClassExamStatsMock.mockReset();
    navigateMock.mockReset();
    closeMock.mockReset();
    navigateMock.mockResolvedValue(true);

    await TestBed.configureTestingModule({
      imports: [ClassScoresDialogComponent],
      providers: [
        { provide: AcademyExamsService, useValue: { list: listMock } },
        { provide: ScoresService, useValue: { getClassExamStats: getClassExamStatsMock } },
        { provide: Router, useValue: { navigate: navigateMock } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              class: baseClass,
              campusId: 'campus-1',
              todoOnly: true,
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('todoOnly: true 時，應以 todo 參數載入考試列表', () => {
    listMock.mockReturnValue(
      of({
        data: [exam],
        meta: { total: 1, page: 1, pageSize: 200 },
      }),
    );
    getClassExamStatsMock.mockReturnValue(of({ data: stats }));

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(listMock).toHaveBeenCalledWith({
      classId: 'class-1',
      todo: true,
      order: 'date_asc',
      pageSize: 200,
    });
    expect(getClassExamStatsMock).not.toHaveBeenCalled();
    expect(component['selectedExamId']()).toBeNull();
  });

  it('todoOnly 模式且無資料時，應顯示待登錄空狀態並隱藏 selector', () => {
    listMock.mockReturnValue(
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 200 },
      }),
    );
    getClassExamStatsMock.mockReturnValue(of({ data: stats }));

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('此班級沒有待登錄的考試');
    expect(host.querySelector('.class-scores-dialog__exam-selector')).toBeNull();
  });

  it('切換到全部後，應重新打 API 且不帶 todo 參數', () => {
    listMock
      .mockReturnValueOnce(
        of({
          data: [],
          meta: { total: 0, page: 1, pageSize: 200 },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: [exam],
          meta: { total: 1, page: 1, pageSize: 200 },
        }),
      );
    getClassExamStatsMock.mockReturnValue(of({ data: stats }));

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component['onExamScopeChange']('all');

    expect(listMock).toHaveBeenNthCalledWith(2, {
      classId: 'class-1',
      pageSize: 200,
    });
    expect(component['selectedExamId']()).toBe('exam-1');
  });

  it('點待登錄列應導向成績登錄頁並關閉 dialog', () => {
    listMock.mockReturnValue(
      of({
        data: [exam],
        meta: { total: 1, page: 1, pageSize: 200 },
      }),
    );
    getClassExamStatsMock.mockReturnValue(of({ data: stats }));

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    fixture.detectChanges();

    const todoRow = fixture.nativeElement.querySelector(
      '.class-scores-dialog__todo-row',
    ) as HTMLButtonElement;
    todoRow.click();

    expect(navigateMock).toHaveBeenCalledWith([
      '/admin/grades/exams',
      'academy',
      'exam-1',
      'scores',
    ]);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
