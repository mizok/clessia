import { ToastComponent } from '@shared/components/toast/toast.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';

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
    expect(config.data.todoOnly).toBe(false);
    expect(config.showHeader).toBe(false);
  });

  it('row click 應以 todoOnly = false 開啟 dialog', () => {
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
    expect(config.data.todoOnly).toBe(false);
  });

  it('點待登錄徽章應以 todoOnly = true 開啟 dialog，且不觸發 row click', () => {
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
    component['todoExamCountMap'].set({ cl1: 2 });
    fixture.detectChanges();

    const todoButton = fixture.nativeElement.querySelector(
      '[data-part=class-todo]',
    ) as HTMLButtonElement;
    todoButton.click();

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.todoOnly).toBe(true);
  });

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
    expect(chap.className).toContain('wide:grid-cols-[13rem_minmax(0,1fr)]');
    expect(host.textContent).toContain('數學進階');
    expect(host.textContent).toContain('A班');
    expect(host.textContent).toContain('上限 20 人');
  });
});
