import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AcademyExamsService, type AcademyExamDetail } from '@core/academy-exams.service';
import { AcademyScoreEditorComponent } from './academy-score-editor.component';

describe('AcademyScoreEditorComponent', () => {
  let fixture: ComponentFixture<AcademyScoreEditorComponent>;
  let component: AcademyScoreEditorComponent;

  const mockScores = [
    {
      studentId: 'stu-1',
      studentName: '王小明',
      studentGrade: '國一',
      score: 85,
      status: 'scored' as const,
      notes: null,
      updatedAt: '2026-04-01T00:00:00Z',
    },
    {
      studentId: 'stu-2',
      studentName: '李小華',
      studentGrade: '國一',
      score: null,
      status: 'scored' as const,
      notes: null,
      updatedAt: '2026-04-01T00:00:00Z',
    },
  ];

  const mockExam: AcademyExamDetail = {
    id: 'exam-1',
    name: '數學小考',
    examType: 'quiz',
    status: 'active',
    examDate: '2026-04-01',
    totalScore: 100,
    scopeNote: '第一章',
    campusId: 'c1',
    subjectId: 's1',
    subjectName: '數學',
    classes: [{ classId: 'cls-1', className: 'A班' }],
    summary: {
      averageScore: 85,
      highestScore: 85,
      lowestScore: 85,
      absentCount: 0,
      recordedCount: 1,
    },
    createdBy: null,
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const academyExamsServiceMock = {
    getScores: vi.fn(() => of({ data: mockScores })),
    saveScores: vi.fn(() => of({ success: true, affected: 1 })),
  };

  const messageServiceMock = { add: vi.fn() };

  beforeEach(async () => {
    academyExamsServiceMock.getScores.mockClear();
    academyExamsServiceMock.saveScores.mockClear();
    messageServiceMock.add.mockClear();

    await TestBed.configureTestingModule({
      imports: [AcademyScoreEditorComponent],
      providers: [
        { provide: AcademyExamsService, useValue: academyExamsServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AcademyScoreEditorComponent);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('exam', mockExam);
    fixture.componentRef.setInput('examId', 'exam-1');

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads scores on init', () => {
    expect(academyExamsServiceMock.getScores).toHaveBeenCalledWith('exam-1');
    expect(component['rows']().length).toBe(2);
    expect(component['loading']()).toBe(false);
  });

  it('maps existing scores into rows', () => {
    const rows = component['rows']();
    expect(rows[0].studentName).toBe('王小明');
    expect(rows[0].score).toBe(85);
    expect(rows[0].status).toBe('scored');
    expect(rows[1].score).toBeNull();
  });

  it('detects dirty state when score changes', () => {
    expect(component['isDirty']()).toBe(false);
    component['onScoreChange'](component['rows']()[1], 72);
    expect(component['isDirty']()).toBe(true);
  });

  it('clears score when status changes to absent', () => {
    const row = component['rows']()[0];
    component['onStatusChange'](row, 'absent');
    expect(row.score).toBeNull();
    expect(row.status).toBe('absent');
  });

  it('saves only dirty rows', () => {
    component['onScoreChange'](component['rows']()[1], 72);
    component['save']();

    expect(academyExamsServiceMock.saveScores).toHaveBeenCalledWith(
      'exam-1',
      expect.arrayContaining([
        expect.objectContaining({ studentId: 'stu-2', score: 72, status: 'scored' }),
      ]),
    );
  });

  it('does not save empty unchanged rows', () => {
    // No changes
    component['save']();
    expect(academyExamsServiceMock.saveScores).not.toHaveBeenCalled();
  });

  it('hides class filter when only one class', () => {
    expect(component['classOptions']().length).toBe(0);
  });

  it('shows class filter when multiple classes', () => {
    const multiClassExam: AcademyExamDetail = {
      ...mockExam,
      classes: [
        { classId: 'cls-1', className: 'A班' },
        { classId: 'cls-2', className: 'B班' },
      ],
    };
    fixture.componentRef.setInput('exam', multiClassExam);
    fixture.detectChanges();
    // 3 items: "全部班級" + 2 classes
    expect(component['classOptions']().length).toBe(3);
  });

  it('renders mobile score cards with student info and editable fields', () => {
    const host = fixture.nativeElement as HTMLElement;
    const cards = host.querySelectorAll('.academy-score-editor__card');

    expect(host.querySelector('.academy-score-editor__card-list')).not.toBeNull();
    expect(cards.length).toBe(2);

    const firstCard = cards[0] as HTMLElement;
    expect(firstCard.textContent).toContain('王小明');
    expect(firstCard.textContent).toContain('國一');
    expect(firstCard.textContent).toContain('分數');
    expect(firstCard.textContent).toContain('狀態');
    expect(firstCard.textContent).toContain('備註');
  });
});
