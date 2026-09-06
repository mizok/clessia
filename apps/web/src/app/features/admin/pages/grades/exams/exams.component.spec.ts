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
      expectedCount: 20,
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
      expectedCount: 25,
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
    // `count = none + partial`（#454）。只 flush `count` 的話 `none`/`partial`
    // 會是 undefined，而那是真實環境不會出現的回應形狀
    academyTodoReq.flush({ count: 2, none: 1, partial: 1 });

    const schoolTodoReq = http.expectOne(`${environment.apiUrl}/api/school-exams/todo-count`);
    // school 沒有分母，所以永遠只有「一筆都沒有」這一級
    schoolTodoReq.flush({ count: 1, none: 1, partial: 0 });

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

  /**
   * 統計卡點進去要篩到**它自己數的那一批**（#457）。橫幅說「3 場一筆都沒登」
   * 而點進去列出的是「所有還沒登完的 8 場」，兩個數字對不起來時
   * **沒有任何東西會紅** —— 所以這裡斷言到 `todoLevel` 那一層，不只 `todo=true`。
   */
  it('高級別橫幅點進去帶 todoLevel=none，不是只有 todo=true', () => {
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
    expect(todoReq.request.params.get('todoLevel')).toBe('none');
    todoReq.flush({
      data: [mockAcademyExams[0]],
      meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    expect(component['statusFilter']()).toBe('todo-none');
  });

  it('低級別橫幅點進去帶 todoLevel=partial —— 兩條橫幅不會篩到同一批', () => {
    const banners = fixture.nativeElement.querySelectorAll(
      'app-todo-banner .todo-banner',
    ) as NodeListOf<HTMLButtonElement>;
    // 高 / 低 / school 三條
    expect(banners.length).toBe(3);

    banners[1].click();
    fixture.detectChanges();

    const todoReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
        req.params.get('todo') === 'true',
    );
    expect(todoReq.request.params.get('todoLevel')).toBe('partial');
    todoReq.flush({
      data: [mockAcademyExams[0]],
      meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE },
    });

    expect(component['statusFilter']()).toBe('todo-partial');
  });

  // 低級別是**中性色**不是淡黃色：色相表示好/壞，深淺才表示還在等/不再等。
  // 「登到一半」每天都會出現，常態花不起警示色（#457）
  it('低級別橫幅走中性色，高級別維持警示色', () => {
    const banners = fixture.nativeElement.querySelectorAll('app-todo-banner .todo-banner');
    expect(banners[0].classList.contains('todo-banner--low')).toBe(false);
    expect(banners[1].classList.contains('todo-banner--low')).toBe(true);
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
