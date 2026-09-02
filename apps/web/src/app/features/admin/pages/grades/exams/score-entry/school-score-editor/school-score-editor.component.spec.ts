import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import {
  SchoolExamsService,
  type SchoolExamDetail,
  type SchoolExamStudent,
} from '@core/school-exams.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SchoolScoreEditorComponent } from './school-score-editor.component';

describe('SchoolScoreEditorComponent', () => {
  let fixture: ComponentFixture<SchoolScoreEditorComponent>;
  let component: SchoolScoreEditorComponent;

  const dialogOpenMock = vi.fn(() => ({ onClose: of(undefined) }));

  const mockExam: SchoolExamDetail = {
    id: 't1',
    academicYear: 114,
    semester: 2,
    examType: 'term_exam',
    name: null,
    label: '114-2 段考',
    examDate: '2026-04-10',
    status: 'active',
    schoolId: 'sch-1',
    schoolName: '測試國中',
    summary: { bySubject: [], totalRecordedCount: 0 },
    createdAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  };

  const mockStudents: SchoolExamStudent[] = [
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

  const schoolExamsServiceMock = {
    getStudents: vi.fn(() =>
      of({
        data: mockStudents,
        meta: { total: 1, page: 1, pageSize: 50 },
      }),
    ),
  };

  const refDataMock = {
    campuses: () => [{ id: 'c1', name: '台北分校' }],
    loadCampuses: vi.fn(),
  };

  const messageServiceMock = { add: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [SchoolScoreEditorComponent],
      providers: [
        { provide: SchoolExamsService, useValue: schoolExamsServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: MessageService, useValue: messageServiceMock },
      ],
    })
      .overrideComponent(SchoolScoreEditorComponent, {
        set: {
          providers: [{ provide: DialogService, useValue: { open: dialogOpenMock } }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SchoolScoreEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('exam', mockExam);
    fixture.componentRef.setInput('examId', 't1');

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads students on init', () => {
    expect(schoolExamsServiceMock.getStudents).toHaveBeenCalled();
    expect(component['students']().length).toBe(1);
  });

  it('opens dynamic score dialog on row click', () => {
    component['openStudentDialog'](mockStudents[0]);

    expect(dialogOpenMock).toHaveBeenCalled();
    expect(dialogOpenMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: 'stu-1',
          examId: 't1',
        }),
      }),
    );
  });

  it('renders student list', () => {
    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('.school-score-editor__row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('王小明');
  });

  // ── 領域結論寫成測試 ──────────────────────────────────────────────────────
  describe('登錄進度的 tone', () => {
    const student = (scoreCount: number, subjectCount: number) =>
      ({ scoreCount, subjectCount }) as never;

    it('全部登完是 done', () => {
      const tone = (component as unknown as { progressTone: (s: never) => string }).progressTone;

      expect(tone.call(component, student(5, 5))).toBe('done');
    });

    it('一科都沒登跟登到一半都是 pending —— 區分靠數字不靠色相', () => {
      const tone = (component as unknown as { progressTone: (s: never) => string }).progressTone;

      expect(tone.call(component, student(0, 5))).toBe('pending');
      expect(tone.call(component, student(3, 5))).toBe('pending');
    });

    it('沒有 overdue —— 查不到段考成績登錄的期限，沒有依據可以催', () => {
      const tone = (component as unknown as { progressTone: (s: never) => string }).progressTone;
      const tones = [student(0, 5), student(3, 5), student(5, 5)].map((s) =>
        tone.call(component, s),
      );

      expect(tones).not.toContain('overdue');
    });
  });
});
