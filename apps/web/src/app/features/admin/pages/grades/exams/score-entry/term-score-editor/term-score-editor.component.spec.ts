import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TermExamsService, type TermExamDetail, type TermExamStudent } from '@core/term-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { TermScoreEditorComponent } from './term-score-editor.component';

describe('TermScoreEditorComponent', () => {
  let fixture: ComponentFixture<TermScoreEditorComponent>;
  let component: TermScoreEditorComponent;

  const mockExam: TermExamDetail = {
    id: 't1',
    academicYear: 114,
    semester: 2,
    period: 'midterm_1',
    label: '114-2 第一次段考',
    examDate: '2026-04-10',
    status: 'active',
    schoolId: 'sch-1',
    schoolName: '測試國中',
    summary: { bySubject: [], totalRecordedCount: 0 },
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const mockStudents: TermExamStudent[] = [
    {
      studentId: 'stu-1',
      studentName: '王小明',
      studentGrade: 'J1',
      campusNames: ['台北分校'],
      scoreCount: 2,
      subjectCount: 2,
      hasScored: true,
      hasAbsent: false,
      hasMakeup: false,
      lastUpdatedAt: '2026-04-10T00:00:00Z',
    },
  ];

  const termExamsServiceMock = {
    getStudents: vi.fn(() =>
      of({
        data: mockStudents,
        meta: { total: 1, page: 1, pageSize: 50 },
      }),
    ),
    getScores: vi.fn(() =>
      of({
        data: [
          {
            studentId: 'stu-1',
            studentName: '王小明',
            studentGrade: 'J1',
            subjectId: 's1',
            subjectName: '國文',
            score: 85,
            status: 'scored' as const,
            notes: null,
            updatedAt: '2026-04-10T00:00:00Z',
          },
        ],
      }),
    ),
    saveScores: vi.fn(() => of({ success: true, affected: 1 })),
  };

  const refDataMock = {
    subjects: () => [
      { id: 's1', name: '國文', sortOrder: 0 },
      { id: 's2', name: '英文', sortOrder: 1 },
    ],
    campuses: () => [{ id: 'c1', name: '台北分校' }],
    loadSubjects: vi.fn(),
    loadCampuses: vi.fn(),
  };

  const messageServiceMock = { add: vi.fn() };
  const confirmationServiceMock = { confirm: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [TermScoreEditorComponent],
      providers: [
        { provide: TermExamsService, useValue: termExamsServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: ConfirmationService, useValue: confirmationServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TermScoreEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('exam', mockExam);
    fixture.componentRef.setInput('examId', 't1');

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads students on init (auto-selects first campus)', () => {
    expect(termExamsServiceMock.getStudents).toHaveBeenCalled();
    expect(component['students']().length).toBe(1);
  });

  it('opens dialog and loads scores', () => {
    component['openStudentDialog'](mockStudents[0]);
    expect(termExamsServiceMock.getScores).toHaveBeenCalledWith('t1', 'stu-1');

    const ds = component['dialogStudent']();
    expect(ds).not.toBeNull();
    expect(ds!.rows.length).toBe(2);
    expect(ds!.rows[0].score).toBe(85);
    expect(ds!.rows[1].score).toBeNull();
  });

  it('detects dirty state in dialog', () => {
    component['openStudentDialog'](mockStudents[0]);
    expect(component['isDirty']()).toBe(false);

    const ds = component['dialogStudent']()!;
    component['onScoreChange'](ds.rows[1], 72);
    expect(component['isDirty']()).toBe(true);
  });

  it('saves dirty scores from dialog', () => {
    component['openStudentDialog'](mockStudents[0]);
    const ds = component['dialogStudent']()!;
    component['onScoreChange'](ds.rows[1], 72);

    component['saveDialog']();

    expect(termExamsServiceMock.saveScores).toHaveBeenCalledWith(
      't1',
      expect.arrayContaining([
        expect.objectContaining({
          studentId: 'stu-1',
          subjectId: 's2',
          score: 72,
          status: 'scored',
        }),
      ]),
    );
  });

  it('clears score when status is absent', () => {
    component['openStudentDialog'](mockStudents[0]);
    const ds = component['dialogStudent']()!;
    component['onStatusChange'](ds.rows[0], 'absent');
    expect(ds.rows[0].score).toBeNull();
  });

  it('renders student list', () => {
    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('.term-score-editor__row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('王小明');
  });
});
