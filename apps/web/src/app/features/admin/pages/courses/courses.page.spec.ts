import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { type Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
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
    list: vi.fn(() => of({ data: [] })),
    batchSetActive: vi.fn(() => of({ updated: 0 })),
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

  beforeEach(async () => {
    // 頂欄分校記在 localStorage —— 不清的話上一條選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    sessionsServiceMock.list.mockClear();
    confirmationServiceMock.confirm.mockClear();

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
});
