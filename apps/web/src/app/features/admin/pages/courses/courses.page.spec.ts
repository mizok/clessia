import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Popover } from 'primeng/popover';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { NEVER, type Observable, Subject, of, throwError } from 'rxjs';
import { beforeAll, vi } from 'vitest';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { CoursesPage } from './courses.page';
import { CampusContextService } from '@core/campus-context.service';
import { CoursesService } from '@core/courses.service';
import { ClassesService, type Class } from '@core/classes.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type Session } from '@core/sessions.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { BrowserStateService } from '@core/browser-state.service';

describe('CoursesPage', () => {
  let fixture: ComponentFixture<CoursesPage>;
  let component: CoursesPage;
  let router: Router;
  const confirmationServiceMock = {
    confirm: vi.fn(),
  };

  const coursesServiceMock = {
    list: vi.fn((): Observable<unknown> => of({ data: [] })),
    delete: vi.fn(),
  };
  const classesServiceMock = {
    list: vi.fn((): Observable<unknown> => of({ data: [] })),
    batchSetActive: vi.fn(() => of({ updated: 0 })),
    delete: vi.fn(),
    batchDelete: vi.fn(),
  };
  const refDataMock = {
    campuses: signal<unknown[]>([]),
    subjects: signal<unknown[]>([]),
    teachers: signal<unknown[]>([]),
    loadCampuses: vi.fn(),
    loadSubjects: vi.fn(),
    loadTeachers: vi.fn(),
  };
  const sessionsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'session-1',
            classId: 'class-1',
            className: '數學 A 班',
            courseId: 'course-1',
            courseName: '數學',
            campusId: 'campus-1',
            campusName: '本校',
            sessionDate: '2026-02-10',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: null,
            teacherName: null,
            status: 'scheduled',
            assignmentStatus: 'unassigned',
            hasChanges: false,
          },
          {
            id: 'session-2',
            classId: 'class-1',
            className: '數學 A 班',
            courseId: 'course-1',
            courseName: '數學',
            campusId: 'campus-1',
            campusName: '本校',
            sessionDate: '2026-06-18',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: null,
            teacherName: null,
            status: 'scheduled',
            assignmentStatus: 'unassigned',
            hasChanges: false,
          },
        ],
      }),
    ),
  };

  /** 建 TestBed 與元件、等第一次渲染完 —— beforeEach 與暖機共用 */
  async function mount() {
    await TestBed.configureTestingModule({
      imports: [CoursesPage],
      providers: [
        provideRouter([]),
        { provide: CoursesService, useValue: coursesServiceMock },
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: SessionsService, useValue: sessionsServiceMock },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
        { provide: BrowserStateService, useValue: { isMobile: () => false } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ConfirmationService, useValue: confirmationServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CoursesPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: '課程管理',
      relativePath: 'courses',
      absolutePath: '/admin/courses',
      role: undefined,
      icon: 'pi-users',
      showInMenu: true,
    });
    router = TestBed.inject(Router);
    await fixture.whenStable();
  }

  // 第一次渲染的固定成本（模板程式碼第一次執行、PrimeNG 第一次注入元件樣式）是之後的 3 倍左右，
  // 全算在第一條測試頭上，高負載時逼近 5s 逾時（不穩定測試盤點 B）。先在 beforeAll 渲染一次暖機：
  // hookTimeout 10s，不算進任何一條的 5s；渲染完就拆掉，不留狀態給測試
  beforeAll(async () => {
    await mount();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    sessionsServiceMock.list.mockClear();
    confirmationServiceMock.confirm.mockClear();

    await mount();
  });

  it('日常頁：頂欄沒有「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(false);
  });

  it('navigates to sessions list with first and last session dates for the class', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (
      component as unknown as { navigateToSessionsList: (target: Class) => void }
    ).navigateToSessionsList(cls);

    expect(sessionsServiceMock.list).toHaveBeenCalledWith({
      classId: 'class-1',
      campusIds: ['campus-1'],
      courseIds: ['course-1'],
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/admin/sessions'], {
      queryParams: {
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        from: '2026-02-10',
        to: '2026-06-18',
      },
    });
  });

  it('falls back to navigation without date range when session lookup fails', () => {
    sessionsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('lookup failed')));
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (
      component as unknown as { navigateToSessionsList: (target: Class) => void }
    ).navigateToSessionsList(cls);

    expect(navigateSpy).toHaveBeenCalledWith(['/admin/sessions'], {
      queryParams: {
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
      },
    });
  });

  it('navigates to unassigned sessions with first and last unassigned session dates for the class', () => {
    const unassignedSessions: Session[] = [
      {
        id: 'session-1',
        classId: 'class-1',
        className: '數學 A 班',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '本校',
        sessionDate: '2026-03-15',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: null,
        teacherName: null,
        status: 'scheduled',
        assignmentStatus: 'unassigned',
        hasChanges: false,
      },
      {
        id: 'session-2',
        classId: 'class-1',
        className: '數學 A 班',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '本校',
        sessionDate: '2026-04-20',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: null,
        teacherName: null,
        status: 'scheduled',
        assignmentStatus: 'unassigned',
        hasChanges: false,
      },
      {
        id: 'session-3',
        classId: 'class-1',
        className: '數學 A 班',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '本校',
        sessionDate: '2026-04-25',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: 'teacher-1',
        teacherName: '王老師',
        status: 'scheduled',
        assignmentStatus: 'assigned',
        hasChanges: false,
      },
    ];
    (sessionsServiceMock.list as any).mockReturnValueOnce(
      of({
        data: unassignedSessions,
      }),
    );
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const cls = {
      id: 'class-1',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '數學 A 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (
      component as unknown as { navigateToUnassignedSessions: (target: Class) => void }
    ).navigateToUnassignedSessions(cls);

    expect(navigateSpy).toHaveBeenCalledWith(['/admin/sessions'], {
      queryParams: {
        classId: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        assignmentStatus: 'unassigned',
        from: '2026-03-15',
        to: '2026-04-20',
      },
    });
  });

  it('uses hasPastSessions instead of scheduleCount for delete warning copy', () => {
    const dialogService = fixture.debugElement.injector.get(DialogService);
    const openSpy = vi.spyOn(dialogService, 'open');
    const cls = {
      id: 'class-2',
      campusId: 'campus-1',
      courseId: 'course-1',
      name: '英文 B 班',
      maxStudents: 20,
      gradeLevels: [],
      nextClassId: null,
      isActive: true,
      usesContactBook: false,
      orgId: 'org-1',
      scheduleCount: 2,
      hasPastSessions: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Class;

    (component as unknown as { confirmDeleteClass: (target: Class) => void }).confirmDeleteClass(
      cls,
    );

    expect(openSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message: '確定要刪除班級「英文 B 班」嗎？此操作無法復原。',
        }),
      }),
    );
  });

  it('explains that batch deactivate keeps existing scheduled sessions', () => {
    const dialogService = fixture.debugElement.injector.get(DialogService);
    const openSpy = vi.spyOn(dialogService, 'open');

    (
      component as unknown as {
        classes: { set: (value: Class[]) => void };
        selectedClassIds: { set: (value: Set<string>) => void };
        batchDeactivate: () => void;
      }
    ).classes.set([
      {
        id: 'class-1',
        campusId: 'campus-1',
        courseId: 'course-1',
        name: '數學 A 班',
        maxStudents: 20,
        gradeLevels: [],
        nextClassId: null,
        isActive: true,
        usesContactBook: false,
        orgId: 'org-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as Class,
    ]);
    (
      component as unknown as {
        selectedClassIds: { set: (value: Set<string>) => void };
      }
    ).selectedClassIds.set(new Set(['class-1']));

    (component as unknown as { batchDeactivate: () => void }).batchDeactivate();

    expect(openSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          message:
            '確定要停用這 1 個班級嗎？僅會停用班級本身，已排課堂維持原樣；停用後無法新增報名與產生課堂。',
        }),
      }),
    );
  });

  it('filters teacher options by the topbar campus（#1138 H2，tabs 拿掉）', () => {
    refDataMock.teachers.set([
      {
        id: 'teacher-1',
        displayName: '王老師',
        subjectNames: ['數學'],
        campusIds: ['campus-1'],
      },
      {
        id: 'teacher-2',
        displayName: '李老師',
        subjectNames: ['英文'],
        campusIds: ['campus-2'],
      },
      {
        id: 'teacher-3',
        displayName: '陳老師',
        subjectNames: ['理化'],
        campusIds: ['campus-1', 'campus-2'],
      },
    ]);

    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();

    const options = (
      component as unknown as {
        filteredStaffOptions: () => Array<{ value: string }>;
      }
    ).filteredStaffOptions();

    expect(options.map((option) => option.value)).toEqual(['teacher-1', 'teacher-3']);
  });

  it('removes selected teachers that do not belong to the topbar campus', () => {
    refDataMock.teachers.set([
      {
        id: 'teacher-1',
        displayName: '王老師',
        subjectNames: ['數學'],
        campusIds: ['campus-1'],
      },
      {
        id: 'teacher-2',
        displayName: '李老師',
        subjectNames: ['英文'],
        campusIds: ['campus-2'],
      },
      {
        id: 'teacher-3',
        displayName: '陳老師',
        subjectNames: ['理化'],
        campusIds: ['campus-1', 'campus-2'],
      },
    ]);

    (
      component as unknown as {
        selectedTeacherIds: { set: (value: string[]) => void };
      }
    ).selectedTeacherIds.set(['teacher-1', 'teacher-2', 'teacher-3']);

    TestBed.inject(CampusContextService).select('campus-1');
    fixture.detectChanges();

    const selectedTeacherIds = (
      component as unknown as {
        selectedTeacherIds: () => string[];
      }
    ).selectedTeacherIds();

    expect(selectedTeacherIds).toEqual(['teacher-1', 'teacher-3']);
  });

  /**
   * **把所有取數收進同一條 `switchMap` 會帶來一個新的失效模式：
   * 內層一 error，外層管線就終止 —— 之後這一頁永遠不會再載入任何東西。**
   *
   * 修改前每次取數是各自獨立的訂閱，錯一次只影響那一次；改成單一管線之後，
   * **一次網路錯誤會把搜尋框變成死的**，而畫面上只有一則 toast，
   * 看起來像「這次失敗了」而不是「這一頁壞了」。
   *
   * 這條釘住「錯過一次之後還能再查」。**沒有它，下一個重構的人會把
   * `catchError` 拿掉，而那個缺陷安靜到沒有人會回報。**
   *
   * 這支 spec 的其他測試用的是立即完成的 `of()` 替身，餵不出「還沒回來的請求」——
   * 所以這一區自己換上可控的 `Subject` 替身，並在收尾時換回去。
   */
  describe('搜尋管線的錯誤復原（#689）', () => {
    const pending: Array<Subject<{ data: never[] }>> = [];

    beforeEach(() => {
      // 這個 app 是 zoneless（Angular 21 + signals），沒有 `fakeAsync` ——
      // 時間用 vitest 的假計時器控制。`debounceTime` 走 asyncScheduler 的 setTimeout。
      vi.useFakeTimers();
      pending.length = 0;
      coursesServiceMock.list.mockReset();
      coursesServiceMock.list.mockImplementation(() => {
        const subject = new Subject<{ data: never[] }>();
        pending.push(subject);
        return subject.asObservable();
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      coursesServiceMock.list.mockReset();
      coursesServiceMock.list.mockImplementation(() => of({ data: [] }));
    });

    it('一次請求失敗之後，後續的搜尋仍然會送出（管線沒有被 error 終止）', () => {
      const type = (text: string) =>
        (component as unknown as { onSearchChange: (v: string) => void }).onSearchChange(text);

      type('數學');
      vi.advanceTimersByTime(300);
      expect(coursesServiceMock.list).toHaveBeenCalledTimes(1);

      pending[0].error(new Error('boom'));

      type('英文');
      vi.advanceTimersByTime(300);

      expect(coursesServiceMock.list).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有資料」。**
   * 斷言**畫面主體**而不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」而不是「尚未建立任何課程」', () => {
    coursesServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadCourses: () => void }).loadCourses();
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('尚未建立任何課程');
  });

  describe('課程列尾「⋯」（#1314 ⑤）', () => {
    const course = (id: string, name: string, subjectId: string, subjectName: string) => ({
      id,
      orgId: 'o',
      campusId: 'campus-1',
      name,
      subjectId,
      subjectName,
      description: null,
      isActive: true,
      gradeLevels: [],
      createdAt: '',
      updatedAt: '',
    });
    const loadOne = () => {
      coursesServiceMock.list.mockReturnValueOnce(
        of({
          data: [course('c1', '國一國文', 's-zh', '國文')],
          meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
          summary: { bySubject: [{ subjectId: 's-zh', subjectName: '國文', count: 1 }] },
        }),
      );
      (component as unknown as { loadCourses: () => void }).loadCourses();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      fixture.detectChanges();
    };

    it('列尾只有「新增班」與「⋯」，編輯／刪除不再並排成圖示鈕', () => {
      loadOne();
      const el = fixture.nativeElement as HTMLElement;

      expect(el.querySelectorAll('button[aria-label="國一國文 的更多動作"]').length).toBe(1);
      expect(el.querySelector('button[aria-label="編輯 國一國文"]')).toBeNull();
      expect(el.querySelector('button[aria-label="刪除 國一國文"]')).toBeNull();
      expect(el.querySelector('button[aria-label="在 國一國文 新增班"]')).not.toBeNull();
    });

    it('選單內容：編輯、刪除；底下有班級時刪除 disabled 且寫明原因', () => {
      const toggle = vi.fn();
      const menu = { toggle } as never;
      const call = (hasClasses: boolean) => {
        (
          component as unknown as {
            openCourseMenu: (e: Event, c: unknown, h: boolean, m: unknown) => void;
          }
        ).openCourseMenu(new Event('click'), { id: 'c1', isActive: true }, hasClasses, menu);
        return (
          component as unknown as {
            courseActionMenuItems: () => { label?: string; disabled?: boolean }[];
          }
        ).courseActionMenuItems();
      };

      const empty = call(false).filter((i) => i.label);
      expect(empty.map((i) => i.label)).toEqual(['編輯課程', '刪除課程']);
      expect(empty[1].disabled).toBe(false);

      const used = call(true).filter((i) => i.label);
      expect(used[1].label).toBe('此課程底下還有班級，無法刪除');
      expect(used[1].disabled).toBe(true);
      expect(toggle).toHaveBeenCalledTimes(2);
    });

    it('刪除類項目上危險色（#1360）：刪除課程、刪除班級有 danger；啟用／停用班級沒有', () => {
      const menu = { toggle: vi.fn() } as never;
      const page = component as unknown as {
        openCourseMenu: (e: Event, c: unknown, h: boolean, m: unknown) => void;
        courseActionMenuItems: () => { label?: string; danger?: boolean }[];
        openActionMenu: (e: Event, c: unknown, m: unknown) => void;
        classActionMenuItems: () => { label?: string; danger?: boolean }[];
      };
      page.openCourseMenu(new Event('click'), { id: 'c1', isActive: true }, false, menu);
      expect(page.courseActionMenuItems().find((i) => i.label === '刪除課程')?.danger).toBe(true);

      for (const isActive of [true, false]) {
        const cls = { id: 'k1', courseId: 'c1', isActive, hasPastSessions: false };
        page.openActionMenu(new Event('click'), cls, menu);
        const items = page.classActionMenuItems();
        expect(items.find((i) => i.label === '刪除班級')?.danger).toBe(true);
        const toggle = items.find((i) => i.label === (isActive ? '停用班級' : '啟用班級'));
        expect(toggle).toBeDefined();
        expect(toggle?.danger).toBeUndefined();
      }
    });
  });

  describe('#1314 視覺對齊：標題兩行、搜尋無標籤、篩選鈕寫狀態、需介入以班為單位', () => {
    const course = (id: string, name: string) => ({
      id,
      orgId: 'o',
      campusId: 'campus-1',
      name,
      subjectId: 's-zh',
      subjectName: '國文',
      description: null,
      isActive: true,
      gradeLevels: [],
      createdAt: '',
      updatedAt: '',
    });
    const klass = (id: string, courseId: string, overrides: Record<string, unknown> = {}) =>
      ({
        id,
        courseId,
        campusId: 'campus-1',
        name: id,
        isActive: true,
        scheduleCount: 1,
        hasUpcomingSessions: true,
        upcomingCancelledCount: 0,
        upcomingUnassignedCount: 0,
        upcomingClassConflictCount: 0,
        upcomingTeacherConflictCount: 0,
        gradeLevels: [],
        ...overrides,
      }) as never;
    const el = () => fixture.nativeElement as HTMLElement;
    const norm = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const setup = () => {
      coursesServiceMock.list.mockReturnValueOnce(
        of({
          data: [course('c1', '國一國文'), course('c2', '國二國文')],
          meta: { total: 2, page: 1, pageSize: 20, totalPages: 1 },
          summary: { bySubject: [{ subjectId: 's-zh', subjectName: '國文', count: 2 }] },
        }),
      );
      (component as unknown as { loadCourses: () => void }).loadCourses();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      // c1：一個沒時段的班＋一個正常班；c2：一個正常班＋一個沒有指派老師的班
      (component as unknown as { classes: { set: (v: unknown[]) => void } }).classes.set([
        klass('a', 'c1', { scheduleCount: 0 }),
        klass('b', 'c1'),
        klass('c', 'c2'),
        klass('d', 'c2', { upcomingUnassignedCount: 2 }),
      ]);
      fixture.detectChanges();
    };

    it('標題是兩行（句點後換行）：N 門課程，／M 個班正在開。', () => {
      setup();
      const h1 = el().querySelector('h1') as HTMLElement;
      expect(h1.querySelector('br')).not.toBeNull();
      expect(norm(h1)).toMatch(/^2 門課程， ?\d+ 個班正在開。$/);
    });

    it('搜尋框沒有可見標籤，但有 aria-label', () => {
      setup();
      expect(el().querySelector('label > span.text-sm.font-semibold')).toBeNull();
      expect(el().querySelector('input[aria-label="搜尋課程或班級"]')).not.toBeNull();
    });

    it('操作紀錄是圖示鈕（文字只給螢幕閱讀器）', () => {
      setup();
      const btn = el().querySelector('button[title="操作紀錄"]') as HTMLElement;
      expect(btn.querySelector('.sr-only')?.textContent).toBe('操作紀錄');
    });

    it('點浮層外面關掉後，「篩選」鈕的 aria-expanded 回到 false（onHide 回寫）', () => {
      setup();
      const btn = el().querySelector('button[aria-label^="篩選"]') as HTMLButtonElement;
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      btn.click();
      fixture.detectChanges();
      expect(btn.getAttribute('aria-expanded')).toBe('true');

      // 外點擊由 Popover 自己關：直接呼叫它的 hide()，會發 onHide
      fixture.debugElement.query(By.directive(Popover)).injector.get(Popover).hide();
      fixture.detectChanges();
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('篩選鈕寫目前狀態：沒條件「全部」；有條件「N 項」', () => {
      setup();
      const btn = () => norm(el().querySelector('button[aria-label^="篩選"]'));
      expect(btn()).toBe('篩選：全部');

      component['selectedSubjectId'].set('s-zh');
      fixture.detectChanges();
      expect(btn()).toMatch(/^篩選：\d+ 項$/);
    });

    it('需介入以「班」計：4 個班裡有 2 個需介入（沒時段、未指派老師）', () => {
      setup();
      expect(
        (component as unknown as { interventionCount: () => number }).interventionCount(),
      ).toBe(2);
      expect(norm(el().querySelector('.bg-zinc-100.rounded-lg'))).toContain('需介入 2 個班');
      expect(norm(el().querySelector('.bg-zinc-100.rounded-lg'))).toContain(
        '沒有未來的課堂，家長看不到下一堂。',
      );
      expect(norm(el().querySelector('.bg-zinc-100.rounded-lg'))).toContain('只看這幾個班');
    });

    it('「只看這幾個班」：課程仍顯示、底下只留需介入的班；再按還原', () => {
      setup();
      // 切到需介入會重新取課程；回同一批
      const again = () =>
        coursesServiceMock.list.mockReturnValueOnce(
          of({
            data: [course('c1', '國一國文'), course('c2', '國二國文')],
            meta: { total: 2, page: 1, pageSize: 20, totalPages: 1 },
            summary: { bySubject: [] },
          }),
        );
      again();
      component['onFilterIntervention']();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      fixture.detectChanges();

      const groups = (
        component as unknown as { courseGroups: () => { classes: { id: string }[] }[] }
      ).courseGroups();
      expect(groups.map((g) => g.classes.map((c) => c.id))).toEqual([['a'], ['d']]);
      expect(norm(el().querySelector('.bg-zinc-100.rounded-lg'))).toContain('只看需介入的 2 個班');

      again();
      component['onStatusFilterChange'](null);
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      fixture.detectChanges();
      const all = (
        component as unknown as { courseGroups: () => { classes: unknown[] }[] }
      ).courseGroups();
      expect(all.map((g) => g.classes.length)).toEqual([2, 2]);
    });

    // 回歸（#1431 起就有的 bug，demo 資料幾乎全是國文所以看不出來）：每一章的右側清單
    // 原本迴圈的是**全部**課程群組，於是兩個科目就把每門課各列兩次
    it('不同科目各歸各章：每章底下只有自己科目的課程，不會每章都列全部', () => {
      coursesServiceMock.list.mockReturnValueOnce(
        of({
          data: [
            course('c1', '國一國文'),
            { ...course('c2', '國一數學'), subjectId: 's-ma', subjectName: '數學' },
          ],
          meta: { total: 2, page: 1, pageSize: 20, totalPages: 1 },
          summary: {
            bySubject: [
              { subjectId: 's-zh', subjectName: '國文', count: 1 },
              { subjectId: 's-ma', subjectName: '數學', count: 1 },
            ],
          },
        }),
      );
      (component as unknown as { loadCourses: () => void }).loadCourses();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      fixture.detectChanges();

      const perChapter = [...el().querySelectorAll('section[data-chapter]')].map((section) =>
        [...section.querySelectorAll('section[aria-label]')].map((c) =>
          c.getAttribute('aria-label'),
        ),
      );
      expect(perChapter).toEqual([['國一國文'], ['國一數學']]);
    });

    it('課程列「N 個班」後面接「，開班中 M」／「，都沒有在開」；沒給 activeClassCount 或沒有班就不寫', () => {
      coursesServiceMock.list.mockReturnValueOnce(
        of({
          data: [
            { ...course('c1', '國一國文'), activeClassCount: 2 },
            { ...course('c2', '國二國文'), activeClassCount: 0 },
            course('c3', '國三國文'),
            { ...course('c4', '高一國文'), activeClassCount: 0 },
          ],
          meta: { total: 4, page: 1, pageSize: 20, totalPages: 1 },
          summary: { bySubject: [{ subjectId: 's-zh', subjectName: '國文', count: 4 }] },
        }),
      );
      (component as unknown as { loadCourses: () => void }).loadCourses();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      (component as unknown as { classes: { set: (v: unknown[]) => void } }).classes.set([
        klass('a', 'c1'),
        klass('b', 'c1'),
        klass('c', 'c2'),
        klass('d', 'c3'),
      ]);
      fixture.detectChanges();

      const row = (name: string) =>
        norm(el().querySelector(`section[aria-label="${name}"]`)).replace(/\s+/g, ' ');
      expect(row('國一國文')).toContain('2 個班，開班中 2');
      expect(row('國二國文')).toContain('1 個班，都沒有在開');
      expect(row('國三國文')).toContain('1 個班');
      expect(row('國三國文')).not.toContain('開班中');
      expect(row('國三國文')).not.toContain('都沒有在開');
      // 沒有班：不寫「都沒有在開」
      expect(row('高一國文')).not.toContain('都沒有在開');
    });

    it('沒有需介入的班：提醒列不出現', () => {
      setup();
      (component as unknown as { classes: { set: (v: unknown[]) => void } }).classes.set([
        klass('b', 'c1'),
        klass('c', 'c2'),
      ]);
      fixture.detectChanges();
      expect(el().textContent).not.toContain('需介入');
    });
  });

  describe('#1314 課程殘差：工具列、0 班課程、批次選取入口、手機狀態行', () => {
    const course = (id: string, name: string) => ({
      id,
      orgId: 'o',
      campusId: 'campus-1',
      name,
      subjectId: 's-zh',
      subjectName: '國文',
      description: null,
      isActive: true,
      gradeLevels: [],
      createdAt: '',
      updatedAt: '',
    });
    const klass = (id: string, courseId: string, overrides: Record<string, unknown> = {}) =>
      ({
        id,
        courseId,
        campusId: 'campus-1',
        name: id,
        isActive: true,
        scheduleCount: 1,
        hasUpcomingSessions: true,
        upcomingCancelledCount: 0,
        upcomingUnassignedCount: 0,
        upcomingClassConflictCount: 0,
        upcomingTeacherConflictCount: 0,
        gradeLevels: [],
        ...overrides,
      }) as never;
    const el = () => fixture.nativeElement as HTMLElement;
    const norm = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const setup = () => {
      coursesServiceMock.list.mockReturnValueOnce(
        of({
          data: [course('c1', '國一國文'), course('c0', '空課程')],
          meta: { total: 2, page: 1, pageSize: 20, totalPages: 1 },
          summary: { bySubject: [{ subjectId: 's-zh', subjectName: '國文', count: 2 }] },
        }),
      );
      (component as unknown as { loadCourses: () => void }).loadCourses();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      (component as unknown as { classes: { set: (v: unknown[]) => void } }).classes.set([
        klass('a', 'c1'),
      ]);
      fixture.detectChanges();
    };
    const courseBtn = (name: string) =>
      Array.from(el().querySelectorAll('section[data-chapter] section button[aria-expanded]')).find(
        (b) => b.textContent?.includes(name),
      ) as HTMLButtonElement;

    it('搜尋框 placeholder 照稿；「篩選」在右群組（page-actions 裡），操作紀錄是時鐘', () => {
      setup();
      const input = el().querySelector('input[aria-label="搜尋課程或班級"]') as HTMLInputElement;
      expect(input.placeholder).toBe('找課程或班級名稱');
      expect(el().querySelector('app-page-actions button[aria-label^="篩選"]')).not.toBeNull();
      expect(el().querySelector('button[title="操作紀錄"] .pi-clock')).not.toBeNull();
    });

    it('0 個班的課程也有「›」、不是 disabled，展開看到「還沒有班」', () => {
      setup();
      const btn = courseBtn('空課程');
      expect(btn.disabled).toBe(false);
      expect(btn.querySelector('.pi-chevron-right')).not.toBeNull();

      btn.click();
      fixture.detectChanges();
      expect(courseBtn('空課程').querySelector('.pi-chevron-down')).not.toBeNull();
      expect(norm(el())).toContain('還沒有班。按「新增班」開第一個班。');
    });

    it('沒有黑色粗線：列首沒有、章與章之間是淺灰細線', () => {
      setup();
      expect(el().querySelector('.border-zinc-900')).toBeNull();
      expect(
        el().querySelector('section[data-chapter]')?.classList.contains('border-zinc-200'),
      ).toBe(true);
    });

    it('批次選取預設收起：沒有勾選框也沒有「全選」；進入後才有，結束會清掉勾選', () => {
      setup();
      expect(el().querySelector('app-class-row input[type="checkbox"]')).toBeNull();
      expect(norm(el())).not.toContain('全選這一頁的班級');

      component['selectionMode'].set(true);
      fixture.detectChanges();
      expect(el().querySelector('app-class-row input[type="checkbox"]')).not.toBeNull();
      expect(norm(el())).toContain('全選這一頁的班級');

      component['selectedClassIds'].set(new Set(['a']));
      component['exitSelectionMode']();
      fixture.detectChanges();
      expect(component['selectionMode']()).toBe(false);
      expect(component['selectedClassIds']().size).toBe(0);
      expect(el().querySelector('app-class-row input[type="checkbox"]')).toBeNull();
    });

    it('「⋯」選單：批次選取／結束批次選取（桌機工具列的選單）', () => {
      setup();
      const items = () =>
        (
          component as unknown as { pageMenuItems: () => { label: string; command: () => void }[] }
        ).pageMenuItems();
      expect(items().map((i) => i.label)).toEqual(['批次選取']);
      items()[0].command();
      expect(component['selectionMode']()).toBe(true);
      expect(items().map((i) => i.label)).toEqual(['結束批次選取']);
    });

    describe('沒有開課班時（#1872）', () => {
      const setClasses = (v: unknown[]) =>
        (component as unknown as { classes: { set: (v: unknown[]) => void } }).classes.set(v);
      const items = () =>
        (component as unknown as { pageMenuItems: () => { label: string }[] }).pageMenuItems();

      it('畫面上沒有任何班：「⋯」與手機的「批次選取班級」都不出現', () => {
        setup();
        setClasses([]);
        fixture.detectChanges();
        expect(items()).toEqual([]);
        expect(el().querySelector('button[title="更多動作"]')).toBeNull();

        vi.spyOn(component as unknown as { isMobile: () => boolean }, 'isMobile').mockReturnValue(
          true,
        );
        (
          component as unknown as {
            openCourseMenu: (e: Event, c: unknown, h: boolean, m: unknown) => void;
          }
        ).openCourseMenu(new Event('click'), course('c1', '國一國文'), false, {
          toggle: vi.fn(),
        });
        const labels = (
          component as unknown as { courseActionMenuItems: () => { label?: string }[] }
        )
          .courseActionMenuItems()
          .map((i) => i.label);
        expect(labels).not.toContain('批次選取班級');
      });

      it('批次模式的說明寫出勾的是班、可以做什麼', () => {
        setup();
        component['selectionMode'].set(true);
        fixture.detectChanges();
        expect(norm(el())).toContain('勾選開課班，可以一次啟用、停用或刪除');
      });

      it('載入中（換條件的空窗）畫面暫時沒班：不退出、勾選還在；資料回來有班照舊', () => {
        setup();
        component['selectionMode'].set(true);
        component['selectedClassIds'].set(new Set(['a']));
        fixture.detectChanges();

        component['loading'].set(true);
        setClasses([]);
        fixture.detectChanges();
        expect(component['selectionMode']()).toBe(true);
        expect(component['selectedClassIds']().has('a')).toBe(true);

        setClasses([klass('a', 'c1')]);
        component['loading'].set(false);
        fixture.detectChanges();
        expect(component['selectionMode']()).toBe(true);
        expect(component['selectedClassIds']().has('a')).toBe(true);
      });

      it('批次模式中篩到沒有班：自動退出並清掉勾選', () => {
        setup();
        component['selectionMode'].set(true);
        component['selectedClassIds'].set(new Set(['a']));
        fixture.detectChanges();

        setClasses([]);
        fixture.detectChanges();
        expect(component['selectionMode']()).toBe(false);
        expect(component['selectedClassIds']().size).toBe(0);
      });
    });

    it('手機的課程「⋯」選單才有「批次選取班級」；桌機沒有', () => {
      setup();
      const menu = { toggle: vi.fn() } as never;
      const open = (mobile: boolean) => {
        vi.spyOn(component as unknown as { isMobile: () => boolean }, 'isMobile').mockReturnValue(
          mobile,
        );
        (
          component as unknown as {
            openCourseMenu: (e: Event, c: unknown, h: boolean, m: unknown) => void;
          }
        ).openCourseMenu(new Event('click'), course('c1', '國一國文'), true, menu);
        return (component as unknown as { courseActionMenuItems: () => { label?: string }[] })
          .courseActionMenuItems()
          .map((i) => i.label);
      };
      expect(open(true)).toContain('批次選取班級');
      expect(open(false)).not.toContain('批次選取班級');
    });

    it('課程列有手機專用的「N 個班」與「狀態：啟用」兩行（A6）', () => {
      setup();
      const row = courseBtn('國一國文').closest('section') as HTMLElement;
      expect(norm(row)).toContain('狀態：啟用');
      expect(row.querySelectorAll('.wide\\:hidden').length).toBeGreaterThanOrEqual(2);
    });

    describe('已結束的班提示（endedClassCount）', () => {
      const setupEnded = (ended: number | undefined, withClass: boolean) => {
        coursesServiceMock.list.mockReturnValueOnce(
          of({
            data: [{ ...course('c1', '國一國文'), endedClassCount: ended }],
            meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
            summary: { bySubject: [{ subjectId: 's-zh', subjectName: '國文', count: 1 }] },
          }),
        );
        (component as unknown as { loadCourses: () => void }).loadCourses();
        if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
        (component as unknown as { classes: { set: (v: unknown[]) => void } }).classes.set(
          withClass ? [klass('a', 'c1')] : [],
        );
        fixture.detectChanges();
      };

      it('有班、另有已結束的：結尾寫「另有 N 個已結束的班，打開篩選裡的「含歷史班級」看。」', () => {
        setupEnded(2, true);
        expect(norm(el())).toContain('另有 2 個已結束的班，打開篩選裡的「含歷史班級」看。');
        expect(norm(el())).not.toContain('只有已結束的班');
      });

      it('沒有未結束的班、只有已結束的：寫「只有已結束的班（N 個）」而不是「還沒有班」', () => {
        setupEnded(3, false);
        expect(norm(el())).toContain('只有已結束的班（3 個）。打開篩選裡的「含歷史班級」看。');
        expect(norm(el())).not.toContain('還沒有班。按「新增班」開第一個班。');
        // 同一門課不會同時出現兩種提示
        expect(norm(el())).not.toContain('另有 3 個已結束的班');
      });

      it('endedClassCount 是 0、或舊後端沒給：不寫提示；真的沒有班才寫「還沒有班」', () => {
        setupEnded(0, true);
        expect(norm(el())).not.toContain('已結束的班');
        setupEnded(undefined, false);
        expect(norm(el())).toContain('還沒有班。按「新增班」開第一個班。');
      });

      it('已經打開「含歷史班級」：它們都列出來了，不再提示', () => {
        component['showHistorical'].set(true);
        setupEnded(2, true);
        expect(norm(el())).not.toContain('另有 2 個已結束的班');
      });
    });

    it('班級時段後面接老師名（同一天多個時段各自帶）；沒有老師就不寫', () => {
      const summary = (
        component as unknown as {
          getScheduleSummary: (s: unknown[]) => string;
        }
      ).getScheduleSummary.bind(component);
      vi.spyOn(component as unknown as { isMobile: () => boolean }, 'isMobile').mockReturnValue(
        false,
      );
      expect(
        summary([
          { weekday: 3, startTime: '17:00:00', endTime: '18:30:00', teacherName: '劉語涵' },
          { weekday: 5, startTime: '18:00:00', endTime: '19:00:00' },
        ]),
      ).toBe('週三 17:00–18:30 · 劉語涵、週五 18:00–19:00');
    });

    it('手機的篩選也是貼在鈕下的 Popover（不再是抽屜）', () => {
      setup();
      vi.spyOn(component as unknown as { isMobile: () => boolean }, 'isMobile').mockReturnValue(
        true,
      );
      const toggle = vi.fn();
      vi.spyOn(
        component as unknown as { filterPopoverRef: () => unknown },
        'filterPopoverRef',
      ).mockReturnValue({ toggle });
      (component as unknown as { onFilterBtnClick: (e: Event) => void }).onFilterBtnClick(
        new Event('click'),
      );
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(el().querySelector('p-drawer')).toBeNull();
    });
  });

  describe('依科目分章（#1314 C1）', () => {
    const course = (id: string, name: string, subjectId: string, subjectName: string) => ({
      id,
      orgId: 'o',
      campusId: 'campus-1',
      name,
      subjectId,
      subjectName,
      description: null,
      isActive: true,
      gradeLevels: [],
      createdAt: '',
      updatedAt: '',
    });
    const load = (data: unknown[], bySubject: unknown[]) => {
      coursesServiceMock.list.mockReturnValueOnce(
        of({
          data,
          meta: { total: data.length, page: 1, pageSize: 20, totalPages: 1 },
          summary: { bySubject },
        }),
      );
      (component as unknown as { loadCourses: () => void }).loadCourses();
      if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
      fixture.detectChanges();
    };
    const chapterHeads = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          'section[data-chapter] > app-chapter-head',
        ),
      ).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

    it('連續同科目歸一章，章名張數讀 summary.bySubject（全量，不是這一頁的列數）', () => {
      load(
        [
          course('c1', '國一國文', 's-zh', '國文'),
          course('c2', '國二國文', 's-zh', '國文'),
          course('c3', '國一數學', 's-ma', '數學'),
        ],
        [
          { subjectId: 's-zh', subjectName: '國文', count: 8 },
          { subjectId: 's-ma', subjectName: '數學', count: 5 },
        ],
      );
      expect(chapterHeads()).toEqual(['國文 8 門', '數學 5 門']);
    });

    it('summary 沒有這一科的數字就只寫科目名，不編數字', () => {
      load([course('c1', '國一國文', 's-zh', '國文')], []);
      expect(chapterHeads()).toEqual(['國文']);
    });
  });

  // #1652（使用者裁定）：有帳單的班不能刪，給停用入口；用明確的「設為停用」，不是翻轉
  describe('刪除被帳單擋下 → 改為停用（#1652）', () => {
    const cls = (id: string, isActive = true) =>
      ({
        id,
        name: `班${id}`,
        isActive,
        hasPastSessions: false,
        endDate: null,
      }) as unknown as Class;
    const billed = (classIds: string[]) =>
      throwError(() => ({ error: { code: 'HAS_INVOICE_ITEMS', error: 'x', classIds } }));

    type Page = {
      openConfirmDialog: (h: string, d: { message: string }, ok: () => void) => void;
      confirmDeleteClass: (c: Class) => void;
      batchDelete: () => void;
      classes: { set: (v: Class[]) => void };
      selectedClassIds: { set: (v: Set<string>) => void };
    };
    let page: Page;
    let dialogs: string[];
    let add: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      page = component as unknown as Page;
      dialogs = [];
      // 確認框一律按「確定」，記下訊息
      page.openConfirmDialog = (_h, d, ok) => {
        dialogs.push(d.message);
        ok();
      };
      add = TestBed.inject(MessageService).add as ReturnType<typeof vi.fn>;
      add.mockClear();
      classesServiceMock.batchSetActive.mockClear();
    });

    it('單筆：409 HAS_INVOICE_ITEMS → 問要不要停用 → 設為停用（false），不是翻轉', () => {
      Object.assign(classesServiceMock, { delete: vi.fn(() => billed(['a'])) });
      page.confirmDeleteClass(cls('a'));
      expect(dialogs.at(-1)).toContain('「班a」已經有帳單，不能刪除。是否改為停用？');
      expect(classesServiceMock.batchSetActive).toHaveBeenCalledWith(['a'], false);
    });

    it('單筆：班已經停用 → 只說明，不給停用按鈕', () => {
      Object.assign(classesServiceMock, { delete: vi.fn(() => billed(['a'])) });
      page.confirmDeleteClass(cls('a', false));
      expect(dialogs).toHaveLength(1); // 只有刪除確認那一個
      expect(classesServiceMock.batchSetActive).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: '「班a」已經有帳單，不能刪除' }),
      );
    });

    it('批次：標出被擋的那幾班、說整批沒刪，只停用那幾班', () => {
      Object.assign(classesServiceMock, { batchDelete: vi.fn(() => billed(['b'])) });
      page.classes.set([cls('a'), cls('b')]);
      page.selectedClassIds.set(new Set(['a', 'b']));
      page.batchDelete();
      expect(dialogs.at(-1)).toContain('「班b」已經有帳單，不能刪除，這次一個都沒有刪');
      expect(classesServiceMock.batchSetActive).toHaveBeenCalledWith(['b'], false);
    });
  });

  // #1641 5b：刪班是悲觀的（歷史課堂、堂數包、帳單都會擋，#1652）—— 等伺服器確認才淡出
  describe('刪除班級：悲觀（#1641 5b）', () => {
    type Page = {
      classes: { set: (v: Class[]) => void; (): Class[] };
      expandedCourseIds: { set: (v: Set<string>) => void; (): Set<string> };
      confirmDeleteClass: (c: Class) => void;
    };
    const page = () => component as unknown as Page;
    const cls = (id: string) => ({ id, courseId: 'course-1', name: `班${id}` }) as Class;
    const ids = () =>
      page()
        .classes()
        .map((c) => c.id);
    const accept = () =>
      vi
        .spyOn(fixture.debugElement.injector.get(DialogService), 'open')
        .mockReturnValue({ onClose: of(true) } as never);

    it('伺服器還沒回：那一班不動', () => {
      accept();
      page().classes.set([cls('a'), cls('b')]);
      classesServiceMock.delete.mockReturnValueOnce(new Subject());
      page().confirmDeleteClass(cls('b'));
      expect(ids()).toEqual(['a', 'b']);
    });

    it('成功：拿掉那一班，背景重抓不變淡、展開的課程不收起來', () => {
      accept();
      page().classes.set([cls('a'), cls('b')]);
      page().expandedCourseIds.set(new Set(['course-1']));
      classesServiceMock.delete.mockReturnValueOnce(of(undefined));
      // 班級的背景重抓先不回來（看「刪除成功那一刻」的列）；課程的重抓照常回來 ——
      // 帶 rows 的重抓不能把展開收起來（篩選才會）
      classesServiceMock.list.mockReturnValueOnce(NEVER);
      page().confirmDeleteClass(cls('b'));
      expect(ids()).toEqual(['a']);
      expect(component['loading']()).toBe(false);
      expect(page().expandedCourseIds().has('course-1')).toBe(true);
    });

    it('失敗：那一班一直都在，並跳錯誤 toast', () => {
      accept();
      page().classes.set([cls('a'), cls('b')]);
      classesServiceMock.delete.mockReturnValueOnce(
        throwError(() => ({ error: { error: '有帳單', code: 'HAS_INVOICE_ITEMS' } })),
      );
      page().confirmDeleteClass(cls('b'));
      expect(ids()).toEqual(['a', 'b']);
      expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    });
  });

  // #1641 5b：刪課程（409 HAS_CLASSES 常見）與批次刪班也是悲觀的 —— 審核席 #1674 的突變：
  // 改成先拿掉 spec 照樣全綠，所以兩條路徑各補「沒回時不動」「失敗一直都在＋toast」
  describe('刪除課程、批次刪班：悲觀（#1641 5b）', () => {
    type Page = {
      courses: { set: (v: unknown[]) => void; (): { id: string }[] };
      classes: { set: (v: Class[]) => void; (): Class[] };
      selectedClassIds: { set: (v: Set<string>) => void };
      confirmDeleteCourse: (c: unknown) => void;
      batchDelete: () => void;
    };
    const page = () => component as unknown as Page;
    const course = (id: string) => ({ id, name: `課${id}` });
    const cls = (id: string) => ({ id, courseId: 'course-1', name: `班${id}` }) as Class;
    const accept = () =>
      vi
        .spyOn(fixture.debugElement.injector.get(DialogService), 'open')
        .mockReturnValue({ onClose: of(true) } as never);
    const courseIds = () =>
      page()
        .courses()
        .map((c) => c.id);
    const classIds = () =>
      page()
        .classes()
        .map((c) => c.id);
    const toastedError = () =>
      expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );

    it('刪課程，伺服器還沒回：那一門課不動', () => {
      accept();
      page().courses.set([course('a'), course('b')]);
      coursesServiceMock.delete.mockReturnValueOnce(new Subject());
      page().confirmDeleteCourse(course('b'));
      expect(courseIds()).toEqual(['a', 'b']);
    });

    it('刪課程失敗：那一門課一直都在，並跳錯誤 toast', () => {
      accept();
      page().courses.set([course('a'), course('b')]);
      coursesServiceMock.delete.mockReturnValueOnce(
        throwError(() => ({ error: { error: '伺服器錯誤' } })),
      );
      page().confirmDeleteCourse(course('b'));
      expect(courseIds()).toEqual(['a', 'b']);
      toastedError();
    });

    it('批次刪班，伺服器還沒回：勾的那幾班不動', () => {
      accept();
      page().classes.set([cls('a'), cls('b'), cls('c')]);
      page().selectedClassIds.set(new Set(['b', 'c']));
      classesServiceMock.batchDelete.mockReturnValueOnce(new Subject());
      page().batchDelete();
      expect(classIds()).toEqual(['a', 'b', 'c']);
    });

    it('批次刪班失敗：勾的那幾班一直都在，並跳錯誤 toast', () => {
      accept();
      page().classes.set([cls('a'), cls('b'), cls('c')]);
      page().selectedClassIds.set(new Set(['b', 'c']));
      classesServiceMock.batchDelete.mockReturnValueOnce(
        throwError(() => ({ error: { error: '伺服器錯誤' } })),
      );
      page().batchDelete();
      expect(classIds()).toEqual(['a', 'b', 'c']);
      toastedError();
    });
  });
});
