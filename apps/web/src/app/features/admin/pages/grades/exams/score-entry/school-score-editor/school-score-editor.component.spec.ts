import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject, of } from 'rxjs';
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

  /**
   * #661：這個元件原本就有 `debounceTime(300)` + `distinctUntilChanged`，
   * **所以它看起來是修好的** —— 而 `debounce` 只解一半。
   *
   * 這一段把替身換成「我們自己控制何時完成」的 `Subject`，既有那幾條仍然用 `of()`。
   */
  describe('搜尋的競態（#661）', () => {
    const pending: Array<{ search: string | undefined; subject: Subject<unknown> }> = [];

    beforeEach(() => {
      pending.length = 0;
      schoolExamsServiceMock.getStudents.mockImplementation(((
        _examId: string,
        params: { search?: string },
      ) => {
        const subject = new Subject<unknown>();
        pending.push({ search: params.search, subject });
        return subject.asObservable();
      }) as never);
      // zoneless（Angular 21 + signals），沒有 `fakeAsync` —— `debounceTime` 走
      // asyncScheduler 的 setTimeout。假計時器裝在元件建立**之後**，
      // 免得上面那幾條的 `whenStable()` 等不到 macrotask。
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const type = (text: string) =>
      (component as unknown as { onSearchInput: (v: string) => void }).onSearchInput(text);
    const shownNames = () =>
      (component as unknown as { students: () => Array<{ studentName: string }> })
        .students()
        .map((s) => s.studentName);
    const res = (names: string[]) => ({
      data: names.map((studentName, i) => ({
        ...mockStudents[0],
        studentId: `stu-${i}`,
        studentName,
      })),
      meta: { total: names.length, page: 1, pageSize: 50 },
    });

    it('連續打字只送出一次請求（最後那個字）', () => {
      schoolExamsServiceMock.getStudents.mockClear();

      type('王');
      type('王小');
      type('王小明');
      vi.advanceTimersByTime(300);

      expect(schoolExamsServiceMock.getStudents).toHaveBeenCalledTimes(1);
      expect(pending.at(-1)?.search).toBe('王小明');
    });

    /**
     * ⚠️ **這個時序實機演不到**（本機 API 太快，兩支照順序回來，修前修後畫面一樣），
     * 只有替身做得到 —— #661 的驗收條件因此改看送出的請求數。
     */
    it('先發的請求後回時不會蓋掉畫面（switchMap 取消）', () => {
      schoolExamsServiceMock.getStudents.mockClear();

      type('王');
      vi.advanceTimersByTime(300);
      type('王小明');
      vi.advanceTimersByTime(300);

      expect(schoolExamsServiceMock.getStudents).toHaveBeenCalledTimes(2);

      pending[1].subject.next(res(['王小明']));
      pending[1].subject.complete();

      // 先發的那支現在才回。它已經被取消，這一筆不該被採用。
      pending[0].subject.next(res(['王一', '王二', '王三']));
      pending[0].subject.complete();

      expect(shownNames()).toEqual(['王小明']);
    });

    /** 對照組：同樣的字不重複送（否則上面兩條在「每次都送」的實作下也會過） */
    it('同樣的關鍵字不重複送出請求', () => {
      schoolExamsServiceMock.getStudents.mockClear();

      type('王小明');
      vi.advanceTimersByTime(300);
      type('王小明');
      vi.advanceTimersByTime(300);

      expect(schoolExamsServiceMock.getStudents).toHaveBeenCalledTimes(1);
    });

    /**
     * 把所有取數收進同一條 `switchMap` 帶來的新失效模式：**內層一 error，
     * 外層管線就終止** —— 這個編輯器之後再也載入不了學生，而畫面上只有一則 toast，
     * 看起來像「這次失敗了」不是「它壞了」。
     */
    it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
      schoolExamsServiceMock.getStudents.mockClear();

      type('王');
      vi.advanceTimersByTime(300);
      expect(schoolExamsServiceMock.getStudents).toHaveBeenCalledTimes(1);

      pending[0].subject.error(new Error('boom'));

      type('林');
      vi.advanceTimersByTime(300);

      expect(schoolExamsServiceMock.getStudents).toHaveBeenCalledTimes(2);

      pending[1].subject.next(res(['林大明']));
      pending[1].subject.complete();
      expect(shownNames()).toEqual(['林大明']);
    });
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
