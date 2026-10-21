import { ToastComponent } from '@shared/components/toast/toast.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';

import { ClassViewComponent } from './class-view.component';

describe('ClassViewComponent', () => {
  let fixture: ComponentFixture<ClassViewComponent>;
  let component: ClassViewComponent;
  let http: HttpTestingController;

  const openMock = vi.fn();

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    await TestBed.configureTestingModule({
      imports: [ClassViewComponent],
      providers: [
        MessageService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: { open: openMock } },
      ],
    })
      .overrideComponent(ClassViewComponent, {
        set: {
          providers: [{ provide: DialogService, useValue: { open: openMock } }],
        },
      })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ClassViewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    const pending = http.match(() => true);
    pending.forEach((req) => {
      if (!req.cancelled) req.flush({ data: [], summary: {}, meta: {} });
    });
    http.verify();
    openMock.mockReset();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * #809 → #1615：toast 的出口是全站唯一的 `<app-toast>`（掛在 App）。元件要是自己
   * `providers: [MessageService]`，`add()` 就只進那一層，全站出口收不到 —— 畫面上零訊號。
   * 查的是**出口渲染出來的訊息**，不是「add 有沒有被呼叫」—— 後者是意圖，前者是結果。
   */
  it('發出的 toast 到得了全站出口 —— 出口裡真的長出訊息（#1615）', () => {
    fixture.detectChanges();

    const outlet = TestBed.createComponent(ToastComponent);
    fixture.debugElement.injector
      .get(MessageService)
      .add({ severity: 'error', summary: '載入失敗', detail: '無法載入課程/班級列表' });
    fixture.detectChanges();

    outlet.detectChanges();
    expect((outlet.nativeElement as HTMLElement).querySelector('.toast')).not.toBeNull();
  });

  it('should start with no campus selected', () => {
    expect(component['campusId']()).toBe('');
    expect(component['searchText']()).toBe('');
  });

  it('頁內沒有分校下拉，分校只跟頂欄走（#1607）', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(TestBed.inject(CampusContextService).allowAll()).toBe(false);

    TestBed.inject(CampusContextService).select('campus-9');
    fixture.detectChanges();

    expect(component['campusId']()).toBe('campus-9');
    expect(
      host.querySelector('[data-part=desktop-filters] p-select[placeholder="選擇分校"]'),
    ).toBeNull();
    const reqs = http.match((r) => r.url.includes('/api/classes'));
    expect(reqs.map((r) => r.request.params.get('campusId'))).toEqual(['campus-9']);
  });

  /**
   * **#812：取數失敗時畫面不能說「無符合的課程／請嘗試調整篩選條件」** ——
   * 那是**叫使用者去做一件不會有用的事**。
   * #809 讓這支的 toast 終於出得來了，但 toast 會消失，而退化畫面留著。
   */
  it('取數失敗時渲染「載入失敗」，不叫使用者調整篩選條件', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges(); // 載入由 campusId 的 toObservable 觸發
    const classRequests = http.match((r) => r.url.includes('/api/classes'));
    classRequests[0].flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('載入失敗');
    expect(host.textContent).not.toContain('請嘗試調整篩選條件');
  });

  it('重試鈕真的重打 /api/classes', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges(); // 載入由 campusId 的 toObservable 觸發
    http
      .match((r) => r.url.includes('/api/classes'))[0]
      .flush(null, {
        status: 500,
        statusText: 'Server Error',
      });
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('app-load-failed button')!
      .click();
    fixture.detectChanges();

    expect(http.match((r) => r.url.includes('/api/classes'))).toHaveLength(1);
  });

  it('should load grouped classes with a single classes request on campus change', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges(); // 載入由 campusId 的 toObservable 觸發
    expect(component['campusId']()).toBe('campus-1');

    const classRequests = http.match((r) => r.url.includes('/api/classes'));
    expect(classRequests).toHaveLength(1);

    classRequests[0].flush({
      data: [
        {
          id: 'class-1',
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: 'course-1',
          courseName: '數學進階',
          campusName: '台北校',
          name: 'A班',
          maxStudents: 20,
          gradeLevels: ['J1', 'J2', 'J3'],
          subjectName: '數學',
          nextClassId: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'class-2',
          orgId: 'org-1',
          campusId: 'campus-1',
          courseId: 'course-1',
          courseName: '數學進階',
          campusName: '台北校',
          name: 'B班',
          maxStudents: 25,
          gradeLevels: ['J1', 'J2', 'J3'],
          subjectName: '數學',
          nextClassId: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      meta: { total: 2, page: 1, pageSize: 100, totalPages: 1 },
    });

    const groups = component['courseGroups']();
    expect(groups).toHaveLength(1);
    expect(groups[0].courseName).toBe('數學進階');
    expect(groups[0].gradeRange).toBe('國一～國三');
    expect(groups[0].classes).toHaveLength(2);
  });

  it('should filter groups by searchText', () => {
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
      {
        courseId: 'c2',
        courseName: '英文',
        subjectId: 'sub-2',
        subjectName: '英文',
        gradeRange: '國二',
        classes: [
          {
            classInfo: {
              id: 'cl2',
              name: 'C班',
              maxStudents: 20,
              gradeLevels: ['J2'],
              courseId: 'c2',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國二',
            gradeLevels: ['J2'],
          },
        ],
      },
    ] as any);

    component['searchText'].set('數學');
    expect(component['filteredGroups']()).toHaveLength(1);

    component['searchText'].set('C班');
    expect(component['filteredGroups']()).toHaveLength(1);
    expect(component['filteredGroups']()[0].courseName).toBe('英文');

    component['searchText'].set('');
    expect(component['filteredGroups']()).toHaveLength(2);
  });

  it('should open class scores dialog with class data', () => {
    const cls = {
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
    } as any;

    TestBed.inject(CampusContextService).select('campus-1');
    component['openClassScores'](cls);

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.class.id).toBe('class-1');
    expect(config.data.campusId).toBe('campus-1');
    expect(config.data.todoOnly).toBeUndefined();
    expect(config.showHeader).toBe(false);
  });

  it('點班級列開該班的成績對話框（不停在待登錄）', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges(); // 先讓換分校的那次載入跑完，再塞測試資料
    http.match((r) => r.url.includes('/api/classes')).forEach((r) => r.flush({ data: [] }));
    component['loadingGroups'].set(false);
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學進階',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
    ] as any);
    fixture.detectChanges();

    const rowButton = fixture.nativeElement.querySelector(
      '[data-part=class-row]',
    ) as HTMLButtonElement;
    rowButton.click();

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.class.id).toBe('cl1');
    expect(config.data.todoOnly).toBeUndefined();
  });

  it('「待登錄 N」徽章是連到最早那場成績登錄頁的連結，不開對話框（#1762 ③）', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();
    http.match((r) => r.url.includes('/api/classes')).forEach((r) => r.flush({ data: [] }));
    component['loadingGroups'].set(false);
    component['courseGroups'].set([group([cls()])] as any);
    component['todoMap'].set({ cl1: { count: 2, examId: 'exam-7' } });
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('[data-part=class-todo]') as HTMLElement;
    expect(badge.tagName).toBe('A');
    expect(badge.getAttribute('href')).toBe('/admin/grades/exams/academy/exam-7/scores');
    expect(badge.textContent?.trim()).toBe('待登錄 2');
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(openMock).not.toHaveBeenCalled();
  });

  it('待登錄場數與連結的那一場都從每班的 todo 查詢來（pageSize 1，取第一筆）', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();
    http
      .match((r) => r.url.includes('/api/classes'))[0]
      .flush({ data: [cls({ id: 'cl1' }), cls({ id: 'cl2' })], meta: {} });

    const todoReqs = http.match((r) => r.url.includes('/api/academy-exams'));
    expect(todoReqs.map((r) => r.request.params.get('class_id'))).toEqual(['cl1', 'cl2']);
    expect(todoReqs[0].request.params.get('todo')).toBe('true');
    // 徽章連「最早那場」：API 預設 date_desc，不帶 order 拿到的是最晚那場
    expect(todoReqs[0].request.params.get('order')).toBe('date_asc');
    expect(todoReqs[0].request.params.get('pageSize')).toBe('1');
    todoReqs[0].flush({ data: [{ id: 'exam-7' }], meta: { total: 3 } });
    todoReqs[1].flush({ data: [], meta: { total: 0 } });

    expect(component['todoMap']()).toEqual({
      cl1: { count: 3, examId: 'exam-7' },
      cl2: { count: 0, examId: null },
    });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[data-part=class-todo]')).toHaveLength(1);
    expect(host.querySelector('[data-part=todo-chip]')?.textContent?.replace(/\s+/g, '')).toBe(
      '待登錄1',
    );
  });

  it('沒有任何班待登錄時不出「待登錄」籌碼（A6 pendTotal 為 0 不畫）', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();
    http.match((r) => r.url.includes('/api/classes')).forEach((r) => r.flush({ data: [] }));
    component['loadingGroups'].set(false);
    component['courseGroups'].set([group([cls()])] as any);
    component['todoMap'].set({ cl1: { count: 0, examId: null } });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-part=todo-chip]')).toBeNull();
  });

  it('班級列：N 人在班、最近一場（M/D）· 不及格 · 缺考、右側平均（#1762 ②）', () => {
    const host = renderRows([
      cls({
        enrolledCount: 17,
        latestExam: {
          examId: 'e1',
          name: '第三次小考',
          examDate: '2026-10-05',
          totalScore: 100,
          avgScore: 72.456,
          failCount: 4,
          absentCount: 1,
        },
      }),
    ]);

    const text = (sel: string) =>
      host.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(text('[data-part=class-meta]')).toBe('國一 · 17 人在班 · 上限 20 人 · 台北校');
    expect(text('[data-part=class-last]')).toBe('最近：第三次小考（10/5） · 不及格 4 人 · 缺考 1');
    expect(text('[data-part=class-avg]')).toBe('72.5 平均');
  });

  it('沒缺考不寫缺考；整數平均不帶小數；沒考過寫「還沒有考試」、平均「—」', () => {
    const host = renderRows([
      cls({
        id: 'cl1',
        latestExam: {
          examId: 'e1',
          name: '期中',
          examDate: '2026-09-30',
          totalScore: 100,
          avgScore: 80,
          failCount: 0,
          absentCount: 0,
        },
      }),
      cls({ id: 'cl2', latestExam: null }),
    ]);

    const lasts = [...host.querySelectorAll('[data-part=class-last]')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    const avgs = [...host.querySelectorAll('[data-part=class-avg]')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(lasts).toEqual(['最近：期中（9/30） · 不及格 0 人', '還沒有考試']);
    expect(avgs).toEqual(['80 平均', '— 平均']);
  });

  it('API 沒帶 enrolledCount／latestExam 時不畫那幾格（不寫成 0 人、還沒有考試）', () => {
    const host = renderRows([cls()]);

    expect(host.querySelector('[data-part=class-meta]')?.textContent).not.toContain('人在班');
    expect(host.querySelector('[data-part=class-last]')).toBeNull();
    expect(host.querySelector('[data-part=class-avg]')).toBeNull();
  });

  it('篩選鈕寫出目前條件：「篩選：全部」→「篩選：國一、國二 · 數學」', () => {
    const host = renderRows([cls()]);
    const btn = () =>
      host.querySelector('[data-part=filter-btn]')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(btn()).toBe('篩選：全部');

    TestBed.inject(ReferenceDataService).subjects.set([{ id: 'sub-1', name: '數學' }] as any);
    component['selectedGrades'].set(['J1', 'J2']);
    component['subjectIdFilter'].set('sub-1');
    fixture.detectChanges();
    expect(btn()).toBe('篩選：國一、國二 · 數學');
  });

  it('縮小範圍時出現「顯示 N 個班（共 M）」，按清除篩選全部還原', () => {
    const host = renderRows([cls({ id: 'cl1', name: 'A班' }), cls({ id: 'cl2', name: 'B班' })]);
    expect(host.querySelector('[data-part=count]')).toBeNull();

    component['searchText'].set('A班');
    component['todoOnly'].set(true);
    component['todoMap'].set({ cl1: { count: 1, examId: 'e1' } });
    component['subjectIdFilter'].set('sub-1');
    component['selectedGrades'].set(['J1']);
    fixture.detectChanges();
    const count = host.querySelector('[data-part=count]') as HTMLElement;
    expect(count.textContent?.replace(/\s+/g, '')).toContain('顯示1個班（共2）·只看有待登錄的');

    count.querySelector('button')!.click();
    fixture.detectChanges();
    expect(component['searchText']()).toBe('');
    expect(component['todoOnly']()).toBe(false);
    expect(component['subjectIdFilter']()).toBeNull();
    expect(component['selectedGrades']()).toEqual([]);
    expect(host.querySelector('[data-part=count]')).toBeNull();
  });

  /** 一班的 fixture；`over` 蓋過預設欄位 */
  function cls(over: Record<string, unknown> = {}) {
    return {
      id: 'cl1',
      name: 'A班',
      maxStudents: 20,
      gradeLevels: ['J1'],
      courseId: 'c1',
      courseName: '數學進階',
      subjectId: 'sub-1',
      subjectName: '數學',
      campusId: 'campus-1',
      campusName: '台北校',
      orgId: 'org-1',
      nextClassId: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
      ...over,
    };
  }

  function group(classes: ReturnType<typeof cls>[]) {
    return {
      courseId: 'c1',
      courseName: '數學進階',
      subjectId: 'sub-1',
      subjectName: '數學',
      gradeRange: '國一',
      classes: classes.map((classInfo) => ({
        classInfo,
        gradeLabels: '國一',
        gradeLevels: ['J1'],
      })),
    };
  }

  /** 走真的載入路徑（/api/classes → buildCourseGroups）把班級列畫出來 */
  function renderRows(classes: ReturnType<typeof cls>[]): HTMLElement {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();
    http.match((r) => r.url.includes('/api/classes'))[0].flush({ data: classes, meta: {} });
    http
      .match((r) => r.url.includes('/api/academy-exams'))
      .forEach((r) => r.flush({ data: [], meta: { total: 0 } }));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders course groups with class rows', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges(); // 先讓換分校的那次載入跑完，再塞測試資料
    http.match((r) => r.url.includes('/api/classes')).forEach((r) => r.flush({ data: [] }));
    component['loadingGroups'].set(false);
    component['courseGroups'].set([
      {
        courseId: 'c1',
        courseName: '數學進階',
        subjectId: 'sub-1',
        subjectName: '數學',
        gradeRange: '國一',
        classes: [
          {
            classInfo: {
              id: 'cl1',
              name: 'A班',
              maxStudents: 20,
              gradeLevels: ['J1'],
              courseId: 'c1',
              campusId: 'campus-1',
              orgId: 'org-1',
              nextClassId: null,
              isActive: true,
              createdAt: '',
              updatedAt: '',
            },
            gradeLabels: '國一',
            gradeLevels: ['J1'],
          },
        ],
      },
    ] as any);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // A6 grades-class：課程分章（.chap），左欄是共用章頭（桌機黏住）＋「N 個班」，右邊是班級列
    const chap = host.querySelector('[data-part=course-group]') as HTMLElement;
    expect(chap).not.toBeNull();
    const head = chap.querySelector('app-chapter-head') as HTMLElement;
    expect(head?.parentElement).toBe(chap);
    expect(head.textContent?.replace(/\s+/g, '')).toContain('1個班');
    // 稿的章名是課程全名，桌機 32px（chapter-head compact），不是預設 44px
    expect(head.querySelector('.chapter-head__name')!.classList).toContain('wide:text-[32px]');
    // 章名下保留科目小字（舊有新無，使用者 10-21 裁；課程名不保證含科目）
    expect(head.querySelector('[data-testid=chapter-sub]')?.textContent?.trim()).toBe('數學');
    expect(chap.className).toContain('wide:grid-cols-[13rem_minmax(0,1fr)]');
    expect(host.textContent).toContain('數學進階');
    expect(host.textContent).toContain('A班');
    expect(host.textContent).toContain('上限 20 人');
  });
});
