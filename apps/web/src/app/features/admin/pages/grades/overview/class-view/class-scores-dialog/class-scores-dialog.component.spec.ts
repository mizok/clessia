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
    passScore: null,
    scopeNote: null,
    campusId: 'campus-1',
    subjectId: null,
    subjectName: null,
    classCount: 1,
    scoreCount: 0,
    expectedCount: 0,
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

  /**
   * **顏色不能是唯一的區分**（WCAG 1.4.1）。
   *
   * 這一頁有兩份渲染：桌機表格與手機卡片。桌機那份的不及格一直有
   * `pi-exclamation-triangle` + `aria-label="不及格"`，而**手機那份只有顏色** ——
   * 兩份手刻的實作改到後來不一樣了，而且沒有任何錯誤。
   *
   * 這條測試釘住的是「兩軌都要有形狀訊號」。修好卻不釘住，它會再漂一次。
   */
  it('不及格在桌機與手機兩軌都有形狀訊號，不只顏色', async () => {
    listMock.mockReturnValue(of({ data: [exam], meta: { total: 1 } }));
    getClassExamStatsMock.mockReturnValue(
      of({
        data: {
          ...stats,
          scores: [
            { studentId: 'stu-1', studentName: '王小明', score: 42, status: 'scored', notes: null },
          ],
        },
      }),
    );

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    component = fixture.componentInstance;
    component['examScope'].set('all');
    component['selectedExamId'].set('exam-1');
    await fixture.whenStable();

    const icons = fixture.nativeElement.querySelectorAll('.class-scores-dialog__fail-icon');

    // 兩軌各一個 —— 表格那一格與卡片那一格
    expect(icons.length).toBe(2);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-label')).toBe('不及格');
    }
  });

  it('不及格門檻改用該場考試的總分比例，不再是跟裸 60 比大小', async () => {
    const smallTotalExam: AcademyExam = { ...exam, id: 'exam-2', totalScore: 50, passScore: null };
    listMock.mockReturnValue(of({ data: [smallTotalExam], meta: { total: 1 } }));
    getClassExamStatsMock.mockReturnValue(
      of({
        data: {
          ...stats,
          examId: 'exam-2',
          scores: [
            { studentId: 'stu-1', studentName: '王小明', score: 40, status: 'scored', notes: null },
          ],
        },
      }),
    );

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    component = fixture.componentInstance;
    component['examScope'].set('all');
    component['selectedExamId'].set('exam-2');
    await fixture.whenStable();

    // 總分 50 的六成是 30，40 分及格——跟裸 60 比大小的舊邏輯會誤判成不及格
    expect(component['isFailing'](40)).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.class-scores-dialog__fail-icon').length).toBe(
      0,
    );
  });

  it('有設定及格線時優先用它，而不是總分的六成', () => {
    const examWithPassScore: AcademyExam = {
      ...exam,
      id: 'exam-3',
      totalScore: 100,
      passScore: 70,
    };
    listMock.mockReturnValue(of({ data: [examWithPassScore], meta: { total: 1 } }));
    getClassExamStatsMock.mockReturnValue(of({ data: stats }));

    fixture = TestBed.createComponent(ClassScoresDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component['selectedExamId'].set('exam-3');

    expect(component['isFailing'](65)).toBe(true);
    expect(component['isFailing'](70)).toBe(false);
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
