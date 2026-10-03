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
    await TestBed.configureTestingModule({
      imports: [ClassViewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: { open: openMock } },
      ],
    })
      .overrideComponent(ClassViewComponent, {
        set: {
          providers: [
            { provide: DialogService, useValue: { open: openMock } },
            // **真的 MessageService，不是 `{ add: vi.fn() }`**：假物件沒有 observable，
            // `<p-toast>` 就算不存在測試也看不出來（#809 就是這樣藏了一週）
            { provide: MessageService, useValue: new MessageService() },
          ],
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
   * **#809：這支元件自己 `providers: [MessageService]`，所以它拿到的是自己的實例，
   * 而 `<p-toast>` 訂閱的是注入它的那一層** —— 模板沒有出口的話，
   * `messageService.add()` 的每一則都沒有訂閱者，畫面上零訊號。
   *
   * 斷言查的是 `document`（`appendTo="body"` 會把 toast 搬出元件），
   * 而且查的是**渲染出來的訊息**，不是「add 有沒有被呼叫」—— 後者是意圖，前者是結果。
   */
  it('發出的 toast 有出口 —— DOM 裡真的長出訊息', () => {
    fixture.detectChanges();

    fixture.debugElement.injector
      .get(MessageService)
      .add({ severity: 'error', summary: '載入失敗', detail: '無法載入課程/班級列表' });
    fixture.detectChanges();

    expect(document.querySelector('.p-toast-message')).not.toBeNull();
  });

  it('should start with no campus selected', () => {
    expect(component['campusId']()).toBe('');
    expect(component['searchText']()).toBe('');
  });

  it('頂欄選了分校就用它、頁內分校下拉收起；頂欄是全部時頁內下拉才出現（#1138）', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('[data-part=desktop-filters] p-select[placeholder="選擇分校"]'),
    ).not.toBeNull();

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
    component['onCampusChange']('campus-1');
    fixture.detectChanges(); // 載入由 campusId 的 toObservable 觸發
    const classRequests = http.match((r) => r.url.includes('/api/classes'));
    classRequests[0].flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('載入失敗');
    expect(host.textContent).not.toContain('請嘗試調整篩選條件');
  });

  it('重試鈕真的重打 /api/classes', () => {
    component['onCampusChange']('campus-1');
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
    component['onCampusChange']('campus-1');
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

    component['localCampusId'].set('campus-1');
    component['openClassScores'](cls);

    expect(openMock).toHaveBeenCalledTimes(1);
    const [, config] = openMock.mock.calls[0] as [unknown, any];
    expect(config.data.class.id).toBe('class-1');
    expect(config.data.campusId).toBe('campus-1');
    expect(config.data.todoOnly).toBe(false);
    expect(config.showHeader).toBe(false);
  });

  it('row click 應以 todoOnly = false 開啟 dialog', () => {
    component['localCampusId'].set('campus-1');
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
    component['localCampusId'].set('campus-1');
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
    component['localCampusId'].set('campus-1');
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
    expect(host.querySelector('[data-part=course-group]')).not.toBeNull();
    expect(host.textContent).toContain('數學進階');
    expect(host.textContent).toContain('A班');
    expect(host.textContent).toContain('上限 20 人');
  });
});
