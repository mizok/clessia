import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { TermExamsService, type TermExamDetail } from '@core/term-exams.service';
import { StudentsService } from '@core/students.service';
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
    summary: { bySubject: [], totalRecordedCount: 0 },
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const termExamsServiceMock = {
    getRecentStudents: vi.fn(() => of({
      data: [
        { studentId: 'stu-1', studentName: '王小明', studentGrade: 'J1', scoreCount: 3, lastUpdatedAt: '2026-04-10T00:00:00Z' },
      ],
    })),
    getScores: vi.fn(() => of({
      data: [
        { studentId: 'stu-1', studentName: '王小明', studentGrade: 'J1', subjectId: 's1', subjectName: '國文', score: 85, status: 'scored' as const, notes: null, updatedAt: '2026-04-10T00:00:00Z' },
      ],
    })),
    saveScores: vi.fn(() => of({ success: true, affected: 1 })),
  };

  const studentsServiceMock = {
    list: vi.fn(() => of({
      data: [
        { id: 'stu-2', name: '李小華', grade: 'J1', isActive: true } as any,
      ],
      summary: { total: 1, activeCount: 1 },
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    })),
  };

  const refDataMock = {
    subjects: () => [
      { id: 's1', name: '國文', sortOrder: 0 },
      { id: 's2', name: '英文', sortOrder: 1 },
    ],
    loadSubjects: vi.fn(),
  };

  const messageServiceMock = { add: vi.fn() };

  beforeEach(async () => {
    termExamsServiceMock.getRecentStudents.mockClear();
    termExamsServiceMock.getScores.mockClear();
    termExamsServiceMock.saveScores.mockClear();
    studentsServiceMock.list.mockClear();
    messageServiceMock.add.mockClear();

    await TestBed.configureTestingModule({
      imports: [TermScoreEditorComponent],
      providers: [
        { provide: TermExamsService, useValue: termExamsServiceMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: MessageService, useValue: messageServiceMock },
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

  it('loads recent students on init', () => {
    expect(termExamsServiceMock.getRecentStudents).toHaveBeenCalledWith('t1');
    expect(component['recentStudents']().length).toBe(1);
  });

  it('toggles student expansion and loads scores', () => {
    component['toggleStudent']('stu-1', '王小明', 'J1');
    expect(component['expandedStudents']().length).toBe(1);
    expect(termExamsServiceMock.getScores).toHaveBeenCalledWith('t1', 'stu-1');

    // Builds rows from subjects
    const student = component['expandedStudents']()[0];
    expect(student.rows.length).toBe(2); // 國文, 英文
    expect(student.rows[0].subjectName).toBe('國文');
    expect(student.rows[0].score).toBe(85); // existing score
    expect(student.rows[1].score).toBeNull(); // no existing score for 英文
  });

  it('collapses student on second toggle', () => {
    component['toggleStudent']('stu-1', '王小明', 'J1');
    expect(component['expandedStudents']().length).toBe(1);
    component['toggleStudent']('stu-1', '王小明', 'J1');
    expect(component['expandedStudents']().length).toBe(0);
  });

  it('detects dirty state', () => {
    component['toggleStudent']('stu-1', '王小明', 'J1');
    expect(component['isDirty']()).toBe(false);

    const rows = component['expandedStudents']()[0].rows;
    component['onScoreChange'](rows[1], 72);
    expect(component['isDirty']()).toBe(true);
  });

  it('saves dirty scores', () => {
    component['toggleStudent']('stu-1', '王小明', 'J1');
    const rows = component['expandedStudents']()[0].rows;
    component['onScoreChange'](rows[1], 72); // 英文 score

    component.save();

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
    component['toggleStudent']('stu-1', '王小明', 'J1');
    const rows = component['expandedStudents']()[0].rows;
    component['onStatusChange'](rows[0], 'absent');
    expect(rows[0].score).toBeNull();
  });

  it('does not save empty unchanged rows', () => {
    component['toggleStudent']('stu-1', '王小明', 'J1');
    component.save();
    expect(termExamsServiceMock.saveScores).not.toHaveBeenCalled();
  });
});
