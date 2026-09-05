import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ExamsComponent } from './exams.component';
import { environment } from '@env/environment';
import { ReferenceDataService } from '@core/reference-data.service';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

describe('ExamsComponent', () => {
  let component: ExamsComponent;
  let fixture: ComponentFixture<ExamsComponent>;
  let http: HttpTestingController;

  const mockAcademyExams = [
    {
      id: 'a1',
      name: '數學小考',
      examType: 'quiz',
      status: 'active',
      examDate: '2026-04-01',
      totalScore: 100,
      scopeNote: '第一章',
      campusId: 'c1',
      subjectId: 's1',
      subjectName: '數學',
      classCount: 2,
      scoreCount: 0,
      createdAt: '2026-03-20T00:00:00Z',
      updatedAt: '2026-03-20T00:00:00Z',
    },
    {
      id: 'a2',
      name: '英文模擬考',
      examType: 'mock_exam',
      status: 'closed',
      examDate: '2026-03-15',
      totalScore: 100,
      scopeNote: '全冊',
      campusId: 'c1',
      subjectId: 's2',
      subjectName: '英文',
      classCount: 3,
      scoreCount: 25,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-16T00:00:00Z',
    },
  ];

  const mockSchoolExams = [
    {
      id: 't1',
      academicYear: 114,
      semester: 2,
      examType: 'term_exam',
      subjectId: null,
      subjectName: null,
      name: null,
      label: '114-2 段考',
      examDate: '2026-04-10',
      status: 'active',
      schoolId: 'sch-1',
      schoolName: '測試國中',
      scoreCount: 0,
      createdAt: '2026-03-20T00:00:00Z',
      updatedAt: '2026-03-20T00:00:00Z',
    },
  ];

  const refDataStub = {
    campuses: () => [],
    subjects: () => [],
    teachers: () => [],
    loadCampuses: () => undefined,
    loadSubjects: () => undefined,
    loadTeachers: () => undefined,
  };

  function flushInitialRequests(): void {
    const academyListReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
        req.params.get('page') === '1' &&
        req.params.get('pageSize') === String(LIST_PAGE_SIZE),
    );
    academyListReq.flush({
      data: mockAcademyExams,
      meta: { total: 2, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    const academyTodoReq = http.expectOne(`${environment.apiUrl}/api/academy-exams/todo-count`);
    academyTodoReq.flush({ count: 2 });

    const schoolTodoReq = http.expectOne(`${environment.apiUrl}/api/school-exams/todo-count`);
    schoolTodoReq.flush({ count: 1 });

    const schoolsReq = http.expectOne(
      (req) =>
        req.url === `${environment.apiUrl}/api/schools` && req.params.get('isActive') === 'true',
    );
    schoolsReq.flush({
      data: [
        {
          id: 'sch-1',
          name: '測試國中',
          shortName: '測中',
          isActive: true,
          studentCount: 10,
          createdAt: '',
          updatedAt: '',
        },
      ],
      meta: { total: 1 },
    });

    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExamsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ReferenceDataService, useValue: refDataStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExamsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    flushInitialRequests();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  it('should create and load academy tab rows from server', () => {
    expect(component).toBeTruthy();
    expect(component['examType']()).toBe('academy');
    expect(component['currentRows']().length).toBe(2);
    expect(component['totalRows']()).toBe(2);
  });

  it('switches to school tab and requests school list from server', () => {
    component['onExamTypeChange']('school');
    fixture.detectChanges();

    const schoolListReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/school-exams`) &&
        req.params.get('page') === '1' &&
        req.params.get('pageSize') === String(LIST_PAGE_SIZE),
    );
    schoolListReq.flush({
      data: mockSchoolExams,
      meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    fixture.detectChanges();
    expect(component['currentRows']().length).toBe(1);
    expect(component['currentRows']()[0].kind).toBe('school');
  });

  it('uses todo=true query when status filter is todo', () => {
    component['onStatusChange']('todo');
    fixture.detectChanges();

    const todoReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
        req.params.get('todo') === 'true',
    );
    todoReq.flush({
      data: [mockAcademyExams[0]],
      meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    fixture.detectChanges();
    expect(component['currentRows']().length).toBe(1);
    expect(component['currentRows']()[0].id).toBe('a1');
  });

  it('clicking todo KPI banner applies todo filter', () => {
    const banner = fixture.nativeElement.querySelector(
      'app-todo-banner .todo-banner',
    ) as HTMLButtonElement;
    expect(banner).not.toBeNull();

    banner.click();
    fixture.detectChanges();

    const todoReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
        req.params.get('todo') === 'true',
    );
    todoReq.flush({
      data: [mockAcademyExams[0]],
      meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    expect(component['statusFilter']()).toBe('todo');
  });

  it('clearFilters resets todo back to all', () => {
    component['onStatusChange']('todo');
    fixture.detectChanges();
    const todoReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
        req.params.get('todo') === 'true',
    );
    todoReq.flush({
      data: [mockAcademyExams[0]],
      meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    component['clearFilters']();
    fixture.detectChanges();

    const clearReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) && !req.params.has('todo'),
    );
    clearReq.flush({
      data: mockAcademyExams,
      meta: { total: 2, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    expect(component['statusFilter']()).toBe('all');
  });

  // ── 領域結論寫成測試 ──────────────────────────────────────────────────────
  // 這幾條不是在測程式碼，是在**釘住業務語意**。常數會沉默，測試不會 ——
  // 誰把「進行中」改回綠色的 done，這裡會紅。
  describe('考試狀態的 tone', () => {
    it('進行中是 pending 不是 done —— 它還在等成績登完', () => {
      const tone = (component as unknown as { statusTone: (s: string) => string }).statusTone;

      expect(tone.call(component, 'active')).toBe('pending');
    });

    it('已結束是 inactive 不是 done —— 關閉不保證成績登完了', () => {
      // 「結束考試」的確認訊息：「結束後將無法再登錄分數」——
      // 它是行政主動關閉，可以沒登完就關
      const tone = (component as unknown as { statusTone: (s: string) => string }).statusTone;

      expect(tone.call(component, 'closed')).toBe('inactive');
    });
  });
});
