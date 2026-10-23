import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { Popover } from 'primeng/popover';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ExamsComponent } from './exams.component';
import { environment } from '@env/environment';
import { CampusContextService } from '@core/campus-context.service';
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
      classes: [
        { id: 'k1', name: '國三數學 A' },
        { id: 'k2', name: '國三數學 B' },
      ],
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
      classes: [
        { id: 'k3', name: '國二英文 A' },
        { id: 'k4', name: '國二英文 B' },
        { id: 'k5', name: '國二英文 C' },
      ],
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
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    await TestBed.configureTestingModule({
      imports: [ExamsComponent],
      providers: [
        MessageService,
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

  it('日常頁：頂欄沒有「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(false);
  });

  it('should create and load academy tab rows from server', () => {
    expect(component).toBeTruthy();
    expect(component['examType']()).toBe('academy');
    expect(component['currentRows']().length).toBe(2);
    expect(component['totalRows']()).toBe(2);
  });

  it('academy 列帶班名：有 scopeNote 時範圍說明為主字、班名補在小字行（#1314 G1）', () => {
    const rows = component['currentRows']() as Array<{
      scope: string;
      classLabel: string | null;
      classTitle: string | null;
    }>;

    expect(rows[0]).toMatchObject({
      scope: '第一章',
      classLabel: '國三數學 A、國三數學 B',
      classTitle: '國三數學 A、國三數學 B',
    });
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

  it('分校跟頂欄走：換分校只發一支校內考查詢，帶 campusId、回第一頁（#1138）', () => {
    component['onPage']({ page: 1 } as never);
    fixture.detectChanges();
    http
      .expectOne(
        (req) =>
          req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
          req.params.get('page') === '2',
      )
      .flush({ data: [], meta: { total: 0, page: 2, pageSize: LIST_PAGE_SIZE } });

    TestBed.inject(CampusContextService).select('c9');
    fixture.detectChanges();

    const reqs = http.match((req) => req.url.startsWith(`${environment.apiUrl}/api/academy-exams`));
    expect(
      reqs.map((r) => [r.request.params.get('campus_id'), r.request.params.get('page')]),
    ).toEqual([['c9', '1']]);
    reqs.forEach((r) =>
      r.flush({ data: [], meta: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE } }),
    );
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
  const buttonByText = (text: string): HTMLButtonElement | undefined =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === text,
    );

  it('「只看還沒登的」帶 todoLevel=none，不是只有 todo=true', () => {
    const btn = buttonByText('只看還沒登的');
    expect(btn).toBeDefined();

    btn!.click();
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

  it('狀態下拉的「待登錄（登到一半）」帶 todoLevel=partial —— 兩條路不會篩到同一批', () => {
    component['onStatusChange']('todo-partial');
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

  it('提示條只剩「只看還沒登的」，登到一半改由章頭承擔（#1314 gate）', () => {
    expect(buttonByText('只看還沒登的')).toBeTruthy();
    expect(buttonByText('只看登到一半的')).toBeFalsy();
  });

  it('「待處理／全部」只是 statusFilter 的預設值（#991 grades Q5）', () => {
    expect(component['tab']()).toBe('all');
    component['setTab']('pending');
    fixture.detectChanges();
    const req = http.expectOne(
      (r) =>
        r.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
        r.params.get('todo') === 'true',
    );
    req.flush({ data: [], meta: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE } });
    expect(component['tab']()).toBe('pending');
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

  /**
   * **#788：取數失敗時畫面不能渲染成「查無資料」。**
   * 這一頁的 `error` 分支本來就把 `currentRows` 設成 `[]`，於是失敗與空清單
   * 在狀態上完全相同 —— #791 還記下它是「唯一謊稱沒資料卻給得出重試」的一頁。
   */
  it('取數失敗時渲染「載入失敗」', () => {
    // `beforeEach` 已經把初始請求收掉了，所以先觸發一次重新載入
    (component as unknown as { reloadListAndCounts: () => void }).reloadListAndCounts();
    fixture.detectChanges();

    const listReq = http.expectOne(
      (req) =>
        req.url.startsWith(`${environment.apiUrl}/api/academy-exams`) && req.params.has('page'),
    );
    listReq.error(new ProgressEvent('boom'));
    // 其餘同時發出的請求照樣收掉，免得 verify() 抱怨
    http.match(() => true).forEach((r) => r.flush({ count: 0, none: 0, partial: 0 }));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
  });

  // #1314：補習班「待處理」分頁依進度分章；其他情況維持扁平列表
  describe('分章', () => {
    const partialExam = { ...mockAcademyExams[0], id: 'a3', name: '登一半', scoreCount: 5 };
    const chapterEls = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('section[data-chapter]'));

    function openPending(rows: unknown[], total = rows.length): void {
      component['setTab']('pending');
      fixture.detectChanges();
      const req = http.expectOne(
        (r) =>
          r.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
          r.params.get('todo') === 'true',
      );
      req.flush({ data: rows, meta: { total, page: 1, pageSize: LIST_PAGE_SIZE } });
      fixture.detectChanges();
    }

    // #1698：A6 exams.html 在 ≤860 覆寫 `.chap`＝橫排、章名 28px（listRow）
    it('章頭用 listRow：手機章名 28px', () => {
      openPending([mockAcademyExams[0]]);
      const name = chapterEls()[0]?.querySelector('.chapter-head__name');
      expect(name?.classList).toContain('text-[28px]');
    });

    it('待處理：還沒登／登到一半兩章，各自場數；全部分頁沒有章', () => {
      openPending([mockAcademyExams[0], partialExam]);
      expect(chapterEls().map((e) => e.getAttribute('data-chapter'))).toEqual(['none', 'partial']);
      const txt = chapterEls().map((e) => e.textContent ?? '');
      expect(txt[0]).toContain('還沒登');
      expect(txt[0]).toContain('數學小考');
      expect(txt[1]).toContain('登到一半');
      expect(txt[1]).toContain('登一半');
      expect(txt[0]).not.toContain('這一頁');

      component['setTab']('all');
      fixture.detectChanges();
      http
        .expectOne(
          (r) =>
            r.url.startsWith(`${environment.apiUrl}/api/academy-exams`) && !r.params.has('todo'),
        )
        .flush({ data: mockAcademyExams, meta: { total: 2, page: 1, pageSize: LIST_PAGE_SIZE } });
      fixture.detectChanges();
      expect(chapterEls().length).toBe(0);
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('li').length).toBe(2);
    });

    it('章頭的場數是各章自己的列數（2 場還沒登、1 場登到一半）', () => {
      openPending([
        mockAcademyExams[0],
        { ...mockAcademyExams[0], id: 'a4', name: '又一場' },
        partialExam,
      ]);
      const heads = chapterEls().map((e) => (e.textContent ?? '').replace(/\s+/g, ''));
      expect(heads[0]).toContain('還沒登2場');
      expect(heads[1]).toContain('登到一半1場');
    });

    it('只有一種進度就只有一章（空章不畫）', () => {
      openPending([mockAcademyExams[0]]);
      expect(chapterEls().map((e) => e.getAttribute('data-chapter'))).toEqual(['none']);
    });

    it('總數超過一頁：章頭標「這一頁」；剛好一頁（20）不標、21 才標', () => {
      openPending([mockAcademyExams[0]], LIST_PAGE_SIZE);
      expect(chapterEls()[0].textContent).not.toContain('這一頁');
      component['setTab']('all');
      fixture.detectChanges();
      http
        .expectOne(
          (r) =>
            r.url.startsWith(`${environment.apiUrl}/api/academy-exams`) && !r.params.has('todo'),
        )
        .flush({ data: [], meta: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE } });
      openPending([mockAcademyExams[0]], LIST_PAGE_SIZE + 1);
      expect(chapterEls()[0].textContent).toContain('這一頁');
    });

    it('學校考試的待處理沒有「登到一半」：維持扁平列表', () => {
      component['onExamTypeChange']('school');
      fixture.detectChanges();
      http
        .match((r) => r.url.startsWith(`${environment.apiUrl}/api/school-exams`))
        .forEach((r) =>
          r.flush({ data: mockSchoolExams, meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE } }),
        );
      component['setTab']('pending');
      fixture.detectChanges();
      http
        .match((r) => r.url.startsWith(`${environment.apiUrl}/api/school-exams`))
        .forEach((r) =>
          r.flush({ data: mockSchoolExams, meta: { total: 1, page: 1, pageSize: LIST_PAGE_SIZE } }),
        );
      fixture.detectChanges();
      expect(component['tab']()).toBe('pending');
      expect(chapterEls().length).toBe(0);
    });
  });

  describe('桌機篩選浮層', () => {
    it('篩選鈕的條件數連搜尋一起算；清除篩選歸零', () => {
      expect(component['desktopFilterCount']()).toBe(0);
      component['onSearchChange']('期中');
      component['onSubjectChange']('s1');
      expect(component['desktopFilterCount']()).toBe(2);
      component['onSearchChange']('   ');
      expect(component['desktopFilterCount']()).toBe(1);
      component['onTimeRangeChange']('3m' as never);
      expect(component['desktopFilterCount']()).toBe(2);
      component['clearFilters']();
      expect(component['desktopFilterCount']()).toBe(0);
    });

    it('「待處理」分頁本身不算條件；「全部」分頁選了狀態才算 1；待處理分頁沒有清除篩選鈕', () => {
      component['setTab']('pending');
      fixture.detectChanges();
      http
        .expectOne(
          (r) =>
            r.url.startsWith(`${environment.apiUrl}/api/academy-exams`) &&
            r.params.get('todo') === 'true',
        )
        .flush({ data: [], meta: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE } });
      fixture.detectChanges();
      expect(component['desktopFilterCount']()).toBe(0);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('篩選：全部');
      // 工具列那顆；列表上方「N 場符合 · 清除篩選」是另一顆（沿用既有判準），不在這裡
      expect(el.querySelector('[data-toolbar-clear]')).toBeNull();

      component['onStatusChange']('active');
      expect(component['tab']()).toBe('all');
      expect(component['desktopFilterCount']()).toBe(1);
      fixture.detectChanges(); // effect 在這輪才送出請求
      http
        .match((r) => r.url.startsWith(`${environment.apiUrl}/api/academy-exams`))
        .forEach((r) =>
          r.flush({ data: [], meta: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE } }),
        );
      fixture.detectChanges();
      expect(el.querySelector('[data-toolbar-clear]')).not.toBeNull();
    });

    // 外點擊關掉浮層時，只有 Popover 的 onHide 會回寫 filtersOpen；少了它鈕會一直是「展開」
    it('浮層 onShow／onHide 回寫篩選鈕的 aria-expanded（外點擊關掉後鈕要回到 false）', () => {
      const el = fixture.nativeElement as HTMLElement;
      const filterBtn = () =>
        Array.from(el.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('篩選：'),
        ) as HTMLButtonElement;
      const popover = fixture.debugElement.query(By.directive(Popover)).injector.get(Popover);

      expect(filterBtn().getAttribute('aria-expanded')).toBe('false');
      filterBtn().click(); // 真的打開浮層（hide() 在沒開的浮層上不會發 onHide）
      fixture.detectChanges();
      popover.onShow.emit(); // jsdom 沒有動畫結束事件，onShow 由這裡補發
      fixture.detectChanges();
      expect(filterBtn().getAttribute('aria-expanded')).toBe('true');

      popover.hide(); // 外點擊、Esc 都是走 hide() 發 onHide
      fixture.detectChanges();
      expect(filterBtn().getAttribute('aria-expanded')).toBe('false');
    });

    it('學校欄位只在學校考試算數', () => {
      component['schoolId'].set('sch-1');
      expect(component['desktopFilterCount']()).toBe(0);
      component['examType'].set('school');
      expect(component['desktopFilterCount']()).toBe(1);
    });

    it('工具列不再常開一排條件：頁面上只有手機那一個搜尋框，條件在浮層（開了才有）', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('input[type="search"]').length).toBe(1);
      const filterBtn = Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('篩選：全部'),
      );
      expect(filterBtn).toBeTruthy();
      expect(filterBtn!.getAttribute('aria-expanded')).toBe('false');
      component['onSearchChange']('期中');
      fixture.detectChanges();
      http
        .match((r) => r.url.startsWith(`${environment.apiUrl}/api/academy-exams`))
        .forEach((r) =>
          r.flush({ data: [], meta: { total: 0, page: 1, pageSize: LIST_PAGE_SIZE } }),
        );
      fixture.detectChanges();
      const after = Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('篩選：'),
      );
      expect(after!.textContent).toContain('篩選：1 項');
      expect(after!.textContent).not.toContain('篩選：全部');
    });
  });

  // #1641 5b（使用者 10-16 裁定第 1 點）：刪除是樂觀的 —— 按下就淡出；失敗要放回去並說明
  describe('樂觀刪除（#1641 5b）', () => {
    const ids = () => (component['currentRows']() as Array<{ id: string }>).map((r) => r.id);
    const target = () => component['currentRows']()[1]!;

    it('選單的「刪除」上危險色（#1360）', () => {
      component['selectedRow'].set(target());
      const items = component['actionMenuItems']() as Array<{ label?: string; danger?: boolean }>;
      expect(items.find((i) => i.label === '刪除')?.danger).toBe(true);
    });
    const deleteReq = () =>
      http.expectOne(
        (req) =>
          req.method === 'DELETE' && req.url === `${environment.apiUrl}/api/academy-exams/a2`,
      );

    it('失敗：那一列放回原位，並跳錯誤 toast', () => {
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');
      component['deleteExam'](target());
      expect(ids()).toEqual(['a1']);
      deleteReq().flush({ error: 'x' }, { status: 500, statusText: 'x' });
      expect(ids()).toEqual(['a1', 'a2']);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('成功：維持拿掉，背景重抓不變淡', async () => {
      component['deleteExam'](target());
      deleteReq().flush({});
      fixture.detectChanges();
      await fixture.whenStable();
      expect(ids()).toEqual(['a1']);
      expect(component['loading']()).toBe(false);
      // 背景重抓（列表＋待辦計數）這裡不關心回應
      http.match(() => true);
    });
  });
});
