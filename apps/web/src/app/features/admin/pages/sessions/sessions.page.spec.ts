import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { Location } from '@angular/common';
import { vi } from 'vitest';
import { format, parseISO } from 'date-fns';
import { AttendanceService, type AttendanceSessionListResponse } from '@core/attendance.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService } from '@core/courses.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type Session } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { StudentsService } from '@core/students.service';

import { SessionsPage } from './sessions.page';
import { CampusContextService } from '@core/campus-context.service';
import { SessionAssignDialogComponent } from './dialogs/session-assign-dialog/session-assign-dialog.component';
import { AttendanceRosterPanelComponent } from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
import { SessionOperationsLogDialogComponent } from './dialogs/session-operations-log-dialog/session-operations-log-dialog.component';
import { SessionMakeupDialogComponent } from './dialogs/session-makeup-dialog/session-makeup-dialog.component';
import { SessionAdvancedFiltersDialogComponent } from '@shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component';

describe('SessionsPage', () => {
  let component: SessionsPage;
  let fixture: ComponentFixture<SessionsPage>;
  let router: Router;
  let routeQueryParams: Record<string, string>;
  const routeFragment = new BehaviorSubject<string | null>(null);
  const refDataMock = {
    campuses: signal<{ id: string; name: string }[]>([]),
    teachers: signal<Staff[]>([]),
    loadCampuses: vi.fn(),
    loadTeachers: vi.fn(),
  };
  const makeListResponse = (data: Session[] = []) => ({
    data,
    meta: {
      total: data.length,
      page: 1,
      pageSize: 20,
      totalPages: Math.max(1, Math.ceil(data.length / 20)),
    },
  });
  const sessionsServiceMock = {
    list: vi.fn(() => of(makeListResponse())),
    hasSessionsOn: vi.fn((_date: string, _campusIds?: string[]) => of(false)),
    listChanges: vi.fn(() => of({ data: [], meta: { total: 0, page: 1, pageSize: 100 } })),
    batchAssignTeacher: vi.fn(() =>
      of({ updated: 0, skippedConflicts: 0, skippedNotEligible: 0, conflicts: [], dryRun: true }),
    ),
    batchUpdateTime: vi.fn(() =>
      of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
    ),
    batchCancel: vi.fn(() =>
      of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
    ),
    batchUncancel: vi.fn(() =>
      of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
    ),
  };
  const attendanceServiceMock = {
    sessions: vi.fn(() =>
      of<AttendanceSessionListResponse>({
        data: [],
        meta: { total: 0, page: 1, pageSize: 1000, totalPages: 1 },
      }),
    ),
  };
  const studentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'student-1',
            orgId: 'org-1',
            name: '王小明',
            grade: 'J1',
            school: '測試國中',
            birthday: null,
            gender: null,
            phone: null,
            email: null,
            address: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            notes: null,
            isActive: true,
            parentNames: ['王爸爸'],
            campusNames: ['示範分校'],
            hasEnrollments: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        summary: { total: 1, activeCount: 1 },
        meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
      }),
    ),
  };
  const enrollmentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [] as Array<{ classId: string }>,
        meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
      }),
    ),
  };

  // 元件的預設日期範圍是 startOfMonth(new Date()) ~ endOfMonth(new Date())，而本檔所有 fixture
  // 都是 2026-04。不凍結時鐘的話，這支測試只有 2026 年 4 月會通過。
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); // 只假造 Date，setTimeout 保持真實，否則 whenStable 會卡住
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    routeQueryParams = {};
    routeFragment.next(null);
    // 頂欄分校記在 localStorage（CampusContextService）—— 不清的話上一條測試選的分校會漏到下一條
    localStorage.removeItem('clessia.campusContext');
    localStorage.removeItem('clessia.campusContext.single');
    sessionsServiceMock.list.mockClear();
    sessionsServiceMock.hasSessionsOn.mockReset();
    sessionsServiceMock.hasSessionsOn.mockReturnValue(of(false));
    sessionsServiceMock.batchAssignTeacher.mockClear();
    sessionsServiceMock.batchUpdateTime.mockClear();
    sessionsServiceMock.batchCancel.mockClear();
    sessionsServiceMock.batchUncancel.mockClear();
    attendanceServiceMock.sessions.mockClear();
    studentsServiceMock.list.mockClear();
    enrollmentsServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [SessionsPage],
      providers: [
        MessageService,
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            fragment: routeFragment.asObservable(),
            get snapshot() {
              return { queryParams: routeQueryParams };
            },
          },
        },
        {
          provide: ReferenceDataService,
          useValue: refDataMock,
        },
        {
          provide: CoursesService,
          useValue: { list: () => of({ data: [] }) },
        },
        {
          provide: ClassesService,
          useValue: { list: () => of({ data: [] }) },
        },
        {
          provide: SessionsService,
          useValue: sessionsServiceMock,
        },
        {
          provide: AttendanceService,
          useValue: attendanceServiceMock,
        },
        {
          provide: StudentsService,
          useValue: studentsServiceMock,
        },
        {
          provide: EnrollmentsService,
          useValue: enrollmentsServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  it('日常頁：頂欄沒有「全部分校」（#1607）', () => {
    const ctx = TestBed.inject(CampusContextService);
    expect(ctx.inUse()).toBe(true);
    expect(ctx.allowAll()).toBe(false);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('openAssignSingle should open assign dialog without calling API immediately', () => {
    const session = {
      id: '00000000-0000-0000-0000-000000000001',
      classId: '00000000-0000-0000-0000-000000000002',
      className: '數學A',
      sessionDate: '2026-03-07',
      startTime: '09:00',
      endTime: '11:00',
      teacherId: null,
      teacherName: null,
      status: 'scheduled',
      assignmentStatus: 'unassigned',
    } as Session;

    const dialogOpenSpy = vi
      .spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      )
      .mockReturnValue({ onClose: of(undefined) });

    (component as unknown as { openAssignSingle: (target: Session) => void }).openAssignSingle(
      session,
    );

    expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
    expect(dialogOpenSpy).toHaveBeenCalledWith(
      SessionAssignDialogComponent,
      expect.objectContaining({
        header: '指派老師',
        data: expect.objectContaining({ session }),
      }),
    );
    expect(sessionsServiceMock.batchAssignTeacher).not.toHaveBeenCalled();
  });

  it('availableTeachers should keep all eligible teachers after selecting course', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    (
      component as unknown as {
        selectedCampusIds: { set: (value: string[]) => void };
        selectedCourseIds: { set: (value: string[]) => void };
      }
    ).selectedCourseIds.set(['course-math']);

    (
      component as unknown as {
        courses: {
          set: (value: Array<{ id: string; campusId: string; subjectId: string }>) => void;
        };
      }
    ).courses.set([{ id: 'course-math', campusId: 'campus-1', subjectId: 'subject-math' }]);

    refDataMock.teachers.set([
      {
        id: 'teacher-a',
        userId: 'user-a',
        orgId: 'org-1',
        displayName: 'Teacher A',
        phone: null,
        email: 'a@example.com',
        birthday: null,
        notes: null,
        subjectIds: ['subject-math'],
        subjectNames: ['Math'],
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        campusIds: ['campus-1'],
        roles: ['teacher'],
        permissions: [],
      },
      {
        id: 'teacher-b',
        userId: 'user-b',
        orgId: 'org-1',
        displayName: 'Teacher B',
        phone: null,
        email: 'b@example.com',
        birthday: null,
        notes: null,
        subjectIds: ['subject-math'],
        subjectNames: ['Math'],
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        campusIds: ['campus-1'],
        roles: ['teacher'],
        permissions: [],
      },
    ]);

    (
      component as unknown as {
        sessions: { set: (value: Session[]) => void };
      }
    ).sessions.set([
      {
        id: 'session-1',
        classId: 'class-1',
        className: 'A班',
        courseId: 'course-math',
        courseName: '國文課',
        campusId: 'campus-1',
        campusName: '示範分校',
        sessionDate: '2026-03-09',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: 'teacher-a',
        teacherName: 'Teacher A',
        status: 'scheduled',
        assignmentStatus: 'assigned',
        hasChanges: false,
      },
      {
        id: 'session-2',
        classId: 'class-1',
        className: 'A班',
        courseId: 'course-math',
        courseName: '國文課',
        campusId: 'campus-1',
        campusName: '示範分校',
        sessionDate: '2026-03-16',
        startTime: '09:00',
        endTime: '11:00',
        teacherId: null,
        teacherName: null,
        status: 'scheduled',
        assignmentStatus: 'unassigned',
        hasChanges: false,
      },
    ]);

    const availableTeachers = (
      component as unknown as { availableTeachers: () => Staff[] }
    ).availableTeachers();

    expect(availableTeachers.map((teacher) => teacher.id)).toEqual(['teacher-a', 'teacher-b']);
  });

  it('一進來是今天的課表（單日甘特），沒有任何生效中的條件', async () => {
    await fixture.whenStable();

    const listDateRange = (component as unknown as { listDateRange: () => Date[] }).listDateRange();
    const activeFilterCount = (
      component as unknown as { activeFilterCount: () => number }
    ).activeFilterCount();
    const hasActiveFilters = (
      component as unknown as { hasActiveFilters: () => boolean }
    ).hasActiveFilters();

    expect(listDateRange).toHaveLength(2);
    // #1174 Q2：甘特預設**顯示停課**（三種狀態全選），所以沒有任何東西被濾掉 —— 0 才是真的。
    // （#640 之前的預設會濾掉停課，那時這裡是 1。）
    expect(activeFilterCount).toBe(0);
    expect(hasActiveFilters).toBe(false);
    expect((component as unknown as { mode: () => string }).mode()).toBe('day');
  });

  it('換天：只查那一天；勾選留著（#1174 G3：快速選取勾的是跨天的）', () => {
    const c = component as unknown as {
      setDay: (d: Date) => void;
      selectedIds: { set: (v: Set<string>) => void; (): Set<string> };
    };
    c.selectedIds.set(new Set(['s1']));
    c.setDay(new Date(2026, 9, 6));
    expect(c.selectedIds().size).toBe(1);
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-06', to: '2026-10-06' }),
    );
  });

  it('週視圖：查週一到週日、勾選留著；上下週留在週視圖；點一天切回那天的日視圖', () => {
    const c = component as unknown as {
      setDay: (d: Date) => void;
      setView: (v: 'day' | 'week') => void;
      shiftWeek: (n: number) => void;
      mode: () => string;
      selectedIds: { set: (v: Set<string>) => void; (): Set<string> };
    };
    c.setDay(new Date(2026, 9, 7)); // 週三
    c.selectedIds.set(new Set(['s1']));
    c.setView('week');
    expect(c.mode()).toBe('week');
    expect(c.selectedIds().size).toBe(1);
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-05', to: '2026-10-11' }),
    );
    c.shiftWeek(1);
    expect(c.mode()).toBe('week');
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-12', to: '2026-10-18' }),
    );
    // 週視圖點的那天剛好就是 day()：仍要切回日視圖並重查
    c.setDay(new Date(2026, 9, 14));
    expect(c.mode()).toBe('day');
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-14', to: '2026-10-14' }),
    );
  });

  // A6 `.wc__h { position: sticky; top: 56px }`：稿的 56 是它自己在捲動區裡的頂欄；app 頂欄在捲動區外，
  // 貼著捲動區頂（top 0）才落在同一處。黏住時底下的課會從它後面捲過，底色要不透明（今天那欄 zinc-50）
  it('週視圖每天的欄頭黏在捲動區頂、底色不透明', async () => {
    const c = component as unknown as {
      setDay: (d: Date) => void;
      setView: (v: 'day' | 'week') => void;
    };
    c.setDay(new Date(2026, 9, 7));
    c.setView('week');
    await fixture.whenStable();
    const heads = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        'section[aria-label^="週"] > header',
      ),
    ];
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) {
      expect(h.classList.contains('sticky')).toBe(true);
      expect(h.classList.contains('top-0')).toBe(true);
      expect(h.classList.contains('bg-white') || h.classList.contains('bg-zinc-50')).toBe(true);
    }
  });

  // #1641 項 3：換週／換日資料套上時依方向淡入；從週切到日是模式切換，不給方向
  it('換週／換日給方向；週視圖點一天（切回日視圖）不給', () => {
    const c = component as unknown as {
      setDay: (d: Date) => void;
      setView: (v: 'day' | 'week') => void;
      shiftWeek: (n: number) => void;
      contentMotion: () => { dir: string } | null;
    };
    c.setDay(new Date(2026, 9, 7));
    c.shiftWeek(1);
    expect(c.contentMotion()?.dir).toBe('forward');
    c.setDay(new Date(2026, 9, 13));
    expect(c.contentMotion()?.dir).toBe('back');
    c.setView('week');
    const before = c.contentMotion();
    c.setDay(new Date(2026, 9, 16));
    expect(c.contentMotion()).toBe(before);
  });

  describe('快速選取（#1174 G3）', () => {
    const ses = (id: string, over: Partial<Session> = {}) =>
      ({
        id,
        classId: 'c1',
        className: '數學A',
        courseId: 'co',
        campusId: 'ca',
        sessionDate: '2026-10-07',
        startTime: '17:00',
        endTime: '18:00',
        teacherId: 't1',
        teacherName: '林',
        status: 'scheduled',
        assignmentStatus: 'assigned',
        hasChanges: false,
        ...over,
      }) as Session;
    type C = {
      setDay: (d: Date) => void;
      selectedIds: () => Set<string>;
      selectedSessions: () => Session[];
      hasCancelledSelection: () => boolean;
      visibleSelectedCount: () => number;
      pickLabel: () => string;
      pickTeacher: (id: string) => void;
      pickClass: (id: string) => void;
      pickDay: (d: string) => void;
      toggleSelect: (r: { id: string; shiftKey: boolean }) => void;
      sessions: { set: (v: Session[]) => void };
      now: { set: (v: Date) => void };
    };

    it('某位老師這週：查今天起到週日、只要正常的課，勾到的不在畫面上也算數', () => {
      const c = component as unknown as C;
      c.setDay(new Date(2026, 9, 7)); // 週三
      c.now.set(new Date(2026, 9, 7, 9));
      sessionsServiceMock.list.mockReturnValueOnce(
        of(
          makeListResponse([
            ses('x1', { sessionDate: '2026-10-09' }),
            ses('x2', { sessionDate: '2026-10-10' }),
          ]),
        ),
      );
      c.pickTeacher('t1');
      expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          teacherIds: ['t1'],
          from: '2026-10-07',
          to: '2026-10-11',
          statuses: ['scheduled'],
        }),
      );
      expect([...c.selectedIds()]).toEqual(['x1', 'x2']);
      // 畫面上（那一天）一堂都沒有，但批次對話框要的資料還在
      expect(c.visibleSelectedCount()).toBe(0);
      expect(c.selectedSessions().map((s) => s.id)).toEqual(['x1', 'x2']);
      expect(c.pickLabel()).toContain('這週（今天起）');
    });

    it('某個班整期：今天起、沒有結束日', () => {
      const c = component as unknown as C;
      c.now.set(new Date(2026, 9, 7, 9));
      c.pickClass('c9');
      const last = (sessionsServiceMock.list.mock.lastCall as unknown[])[0] as Record<
        string,
        unknown
      >;
      expect(last).toMatchObject({ classIds: ['c9'], from: '2026-10-07', statuses: ['scheduled'] });
      expect(last['to']).toBeUndefined();
    });

    it('這一整天勾畫面上那天的全部（含停課，才能批次恢復）；Shift 勾從上一堂勾到這一堂', () => {
      const c = component as unknown as C;
      c.sessions.set([
        ses('a', { startTime: '09:00', endTime: '10:00', teacherId: 't1' }),
        ses('b', { startTime: '10:00', endTime: '11:00', teacherId: 't1', status: 'cancelled' }),
        ses('c', { startTime: '09:00', endTime: '10:00', teacherId: 't2', teacherName: '王' }),
        ses('z', { sessionDate: '2026-10-08' }),
      ]);
      c.pickDay('2026-10-07');
      expect([...c.selectedIds()].sort()).toEqual(['a', 'b', 'c']);
      expect(c.hasCancelledSelection()).toBe(true);

      // 日視圖手上只有那一天的課（上面那筆別天的只是用來驗「這一整天」不會勾到它）
      c.sessions.set(c.selectedSessions());
      (component as unknown as { clearSelection: () => void }).clearSelection();
      c.toggleSelect({ id: 'a', shiftKey: false });
      c.toggleSelect({ id: 'c', shiftKey: true });
      // 甘特順序：林老師那列（a, b）在上、王老師（c）在下 —— 中間的 b 一起勾
      expect([...c.selectedIds()].sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('頂欄分校（#1138 H2）', () => {
    it('一進來只查一次（沒選過＝全部分校，不帶 campusIds）', async () => {
      await fixture.whenStable();
      expect(sessionsServiceMock.list).toHaveBeenCalledTimes(1);
      expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ campusIds: undefined }),
      );
    });

    it('頂欄換分校：帶那間重查；課程篩選裡不屬於它的拿掉、屬於它的留著', async () => {
      await fixture.whenStable();
      const c = component as unknown as {
        courses: { set: (v: Array<{ id: string; campusId: string }>) => void };
        selectedCourseIds: { set: (v: string[]) => void; (): string[] };
      };
      c.courses.set([
        { id: 'math-a', campusId: 'campus-a' },
        { id: 'math-b', campusId: 'campus-b' },
      ]);
      c.selectedCourseIds.set(['math-a', 'math-b']);
      sessionsServiceMock.list.mockClear();

      TestBed.inject(CampusContextService).select('campus-b');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c.selectedCourseIds()).toEqual(['math-b']);
      expect(sessionsServiceMock.list).toHaveBeenCalledTimes(1);
      expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ campusIds: ['campus-b'], courseIds: ['math-b'] }),
      );
    });

    it('手機篩選沒帶分校回來：不把頂欄寫回全部分校（#1607）', async () => {
      const ctx = TestBed.inject(CampusContextService);
      ctx.select('campus-b');
      vi.spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      ).mockReturnValue({
        onClose: of({
          campusIds: [],
          courseIds: [],
          teacherIds: [],
          classIds: [],
          studentIds: [],
          statuses: [],
        }),
      });

      (component as unknown as { openMobileFiltersDialog: () => void }).openMobileFiltersDialog();
      await fixture.whenStable();

      expect(ctx.id()).toBe('campus-b');
      expect(localStorage.getItem('clessia.campusContext')).toBe('campus-b');
    });
  });

  it('隱藏停課：狀態收成正常＋已完成；回到課表時恢復全部', () => {
    const c = component as unknown as {
      hideCancelled: () => void;
      backToSchedule: () => void;
      selectedStatuses: () => string[];
      mode: { set: (v: string) => void; (): string };
    };
    c.hideCancelled();
    expect(c.selectedStatuses()).toEqual(['scheduled', 'completed']);
    c.mode.set('results');
    c.backToSchedule();
    expect(c.mode()).toBe('day');
    expect(c.selectedStatuses()).toEqual(['scheduled', 'completed', 'cancelled']);
  });

  // P1-6：從儀表板未點名卡連過來時，這頁要真的套用那組篩選，不是安靜地
  // 顯示預設的整月資料。用 TestBed.resetTestingModule 重建一次是因為
  // ActivatedRoute 的 query params 只在元件建立那一刻讀一次（`ngOnInit`），
  // 頂層 `beforeEach` 已經用空的 `routeQueryParams` 建過元件了
  it('帶著儀表板的 queryParams 進來時，套用日期區間、attendanceTaken、endedOnly 與 statuses 篩選', async () => {
    TestBed.resetTestingModule();
    routeQueryParams = {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-15',
      attendanceTaken: 'false',
      endedOnly: 'true',
      // **刻意不是 `DEFAULT_STATUSES`（#456）。** 送 `scheduled,completed` 的話，
      // 就算這頁完全不讀這個參數、只是退回自己的預設值，這條也照樣綠——
      // 那正是這支 issue 要修的病：兩份獨立的預設值剛好相等，
      // **分歧的樣子跟正常的樣子一模一樣**。用一組不同的值才有辨識力
      statuses: 'scheduled',
    };
    sessionsServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [SessionsPage],
      providers: [
        MessageService,
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            fragment: routeFragment.asObservable(),
            get snapshot() {
              return { queryParams: routeQueryParams };
            },
          },
        },
        { provide: ReferenceDataService, useValue: refDataMock },
        { provide: CoursesService, useValue: { list: () => of({ data: [] }) } },
        { provide: ClassesService, useValue: { list: () => of({ data: [] }) } },
        { provide: SessionsService, useValue: sessionsServiceMock },
        { provide: AttendanceService, useValue: attendanceServiceMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
      ],
    }).compileComponents();

    const localFixture = TestBed.createComponent(SessionsPage);
    localFixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    await localFixture.whenStable();

    const localComponent = localFixture.componentInstance as unknown as {
      listDateRange: () => Date[];
      attendanceTakenFilter: () => boolean | undefined;
      endedOnlyFilter: () => boolean;
      selectedStatuses: () => string[];
      onStatusesChange: (statuses: string[] | null) => void;
    };

    expect(localComponent.listDateRange()[0]).toEqual(parseISO('2026-04-01'));
    expect(localComponent.listDateRange()[1]).toEqual(parseISO('2026-04-15'));
    expect(localComponent.attendanceTakenFilter()).toBe(false);
    expect(localComponent.endedOnlyFilter()).toBe(true);
    // 下面 `onStatusesChange(null)` 會把它清成 []，所以這條必須在那之前
    expect(localComponent.selectedStatuses()).toEqual(['scheduled']);

    // 落地頁真的把這個篩選送進 API 請求，不是只停在畫面狀態上沒送出去——
    // `firstCampus$`（ngOnInit 自然觸發 loadSessions 的路徑）在這個測試檔的
    // mock 裡從來不會 emit（`refDataMock.campuses` 全檔都是空陣列），所以
    // 借另一個會觸發 loadSessions 的既有方法來驗證，不改動已經斷言過的篩選狀態
    localComponent.onStatusesChange(null);

    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ attendanceTaken: false, endedOnly: true }),
    );
  });

  /**
   * #592（使用者 2026-09-07 裁定）：**停課後那則提示不能寫「安排補課」。**
   *
   * 這個系統**沒有 `POST /sessions`** —— 課堂的唯一建立路徑是「照班級的 schedules
   * 產生」。「安排」暗示可以新增一堂課，而**使用者會去找那個不存在的流程，
   * 然後以為是自己不會用**。
   *
   * 這條盯的是**那個裁定**（不能暗示可以新增課堂），不是某一句特定文案 ——
   * 改寫文案時改這裡的斷言，但不要讓它變成零。
   */
  it('停課後的提示不暗示可以新增課堂', () => {
    const local = component as unknown as {
      dialogService: { open: (...args: unknown[]) => unknown };
      messageService: { add: (...args: unknown[]) => void };
      openCancelDialog: (target: Session) => void;
    };
    vi.spyOn(local.dialogService, 'open').mockReturnValue({ onClose: of('refresh') });
    const addSpy = vi.spyOn(local.messageService, 'add');

    local.openCancelDialog({ id: 'sess-cancel-copy', status: 'scheduled' } as Session);

    const toast = addSpy.mock.calls.map((c) => c[0] as { detail?: string }).find((a) => a?.detail);
    expect(toast?.detail).toBeDefined();
    expect(toast!.detail).not.toContain('安排');
  });

  it('clearFilters only resets advanced filters and keeps campus/date scope', () => {
    TestBed.inject(CampusContextService).select('campus-1');
    (
      component as unknown as {
        listDateRange: { set: (value: Date[]) => void };
      }
    ).listDateRange.set([new Date('2026-03-01'), new Date('2026-03-10')]);
    (
      component as unknown as {
        listDateRangeModified: { set: (value: boolean) => void };
      }
    ).listDateRangeModified.set(true);
    (
      component as unknown as {
        selectedCourseIds: { set: (value: string[]) => void };
      }
    ).selectedCourseIds.set(['course-1']);
    (
      component as unknown as {
        selectedStatuses: { set: (value: string[]) => void };
      }
    ).selectedStatuses.set(['cancelled']);

    const activeFilterCountBeforeClear = (
      component as unknown as { activeFilterCount: () => number }
    ).activeFilterCount();
    const hasActiveFiltersBeforeClear = (
      component as unknown as { hasActiveFilters: () => boolean }
    ).hasActiveFilters();

    (component as unknown as { clearFilters: () => void }).clearFilters();

    const selectedCampusIdsAfterClear = (
      component as unknown as { selectedCampusIds: () => string[] }
    ).selectedCampusIds();
    const listDateRangeAfterClear = (
      component as unknown as { listDateRange: () => Date[] }
    ).listDateRange();
    const activeFilterCountAfterClear = (
      component as unknown as { activeFilterCount: () => number }
    ).activeFilterCount();
    const hasActiveFiltersAfterClear = (
      component as unknown as { hasActiveFilters: () => boolean }
    ).hasActiveFilters();

    expect(activeFilterCountBeforeClear).toBe(2);
    expect(hasActiveFiltersBeforeClear).toBe(true);
    expect(selectedCampusIdsAfterClear).toEqual(['campus-1']);
    expect(listDateRangeAfterClear).toHaveLength(2);
    // #1174 Q2：清完之後狀態回到預設＝全部狀態（甘特顯示停課），沒有東西被濾掉 —— 0。
    // `hasActiveFilters` 刻意仍然是 false：它控的是「清除篩選」按鈕，
    // 而已經清乾淨了就不該再出現那顆按鈕。**兩個 signal 回答不同的問題。**
    expect(activeFilterCountAfterClear).toBe(0);
    expect(hasActiveFiltersAfterClear).toBe(false);
  });

  it('openAdvancedFiltersDialog should apply result from shared dialog and reload sessions', async () => {
    TestBed.inject(CampusContextService).select('campus-1');

    const dialogOpenSpy = vi
      .spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      )
      .mockReturnValue({
        onClose: of({
          courseIds: ['course-1'],
          classIds: ['class-1'],
          teacherIds: ['teacher-1'],
          studentIds: ['student-1'],
          statuses: ['completed'],
        }),
      });
    enrollmentsServiceMock.list.mockReturnValueOnce(
      of({
        data: [
          {
            classId: 'class-1',
            campusId: 'campus-1',
            status: 'active',
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
          },
        ],
        meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
      }),
    );

    await (
      component as unknown as {
        openAdvancedFiltersDialog: () => void;
      }
    ).openAdvancedFiltersDialog();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      SessionAdvancedFiltersDialogComponent,
      expect.objectContaining({
        header: '進階篩選',
        closable: true,
        data: expect.objectContaining({
          mode: 'sessions',
          selectedCampusIds: ['campus-1'],
          selectedStudentIds: [],
        }),
      }),
    );
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      studentId: 'student-1',
      page: 1,
      pageSize: 100,
    });
    // 這條要斷言的一直都是**主查詢帶了什麼**（#640 時期 `loadSessions()` 還會多打一支
    // 停課計數查詢，「最後一次」因此不可靠；#950 把它搬進 meta 之後仍維持問原本的問題）。
    expect(sessionsServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({
        campusIds: ['campus-1'],
        courseIds: ['course-1'],
        teacherIds: ['teacher-1'],
        classIds: ['class-1'],
        statuses: ['completed'],
        page: 1,
      }),
    );
    // #950 之後停課數跟著主查詢的 meta 回來，前端不再另發計數查詢
    expect(sessionsServiceMock.list).not.toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['cancelled'] }),
    );
  });

  it('treats empty status selection as all statuses', () => {
    // 日期範圍只在「篩選結果」生效（課表是單日）
    (component as unknown as { mode: { set: (v: string) => void } }).mode.set('results');
    (
      component as unknown as {
        listDateRange: { set: (value: Date[]) => void };
      }
    ).listDateRange.set([new Date('2026-03-09'), new Date('2026-03-16')]);

    (
      component as unknown as {
        onStatusesChange: (value: string[] | null) => void;
      }
    ).onStatusesChange([]);

    const selectedStatuses = (
      component as unknown as { selectedStatuses: () => string[] }
    ).selectedStatuses();

    expect(selectedStatuses).toEqual([]);
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: '2026-03-09',
        to: '2026-03-16',
        statuses: undefined,
        page: 1,
        pageSize: 500,
      }),
    );
  });

  it('keeps filters in memory without syncing query params', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    // 日期範圍只在「篩選結果」生效（課表是單日）
    (component as unknown as { mode: { set: (v: string) => void } }).mode.set('results');

    // 分校只有一個來源（頂欄，#1138 H2），不再能多選
    TestBed.inject(CampusContextService).select('campus-1');
    (
      component as unknown as {
        listDateRange: { set: (value: Date[]) => void };
      }
    ).listDateRange.set([new Date('2026-03-16'), new Date('2026-07-02')]);

    (
      component as unknown as {
        onCourseIdsChange: (value: string[]) => void;
        onStatusesChange: (value: string[] | null) => void;
      }
    ).onCourseIdsChange(['course-1']);
    (
      component as unknown as {
        onTeacherIdsChange: (value: string[]) => void;
      }
    ).onTeacherIdsChange(['teacher-1', '__unassigned__']);
    (
      component as unknown as {
        onClassChange: (value: string[]) => void;
      }
    ).onClassChange(['class-1', 'class-2']);
    (
      component as unknown as {
        onStatusesChange: (value: string[] | null) => void;
      }
    ).onStatusesChange([]);

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith({
      from: '2026-03-16',
      to: '2026-07-02',
      campusIds: ['campus-1'],
      courseIds: ['course-1'],
      teacherIds: ['teacher-1'],
      assignmentStatus: 'unassigned',
      classIds: ['class-1', 'class-2'],
      endedOnly: false,
      statuses: undefined,
      page: 1,
      pageSize: 500,
    });
  });

  it('filters displayed sessions by selected student enrollments', () => {
    (
      component as unknown as {
        sessions: { set: (value: Session[]) => void };
        selectedStudentIds: { set: (value: string[]) => void };
        studentEnrolledClassIds: { set: (value: Set<string>) => void };
        studentFilteredEnrollments: {
          set: (
            value: Array<{
              classId: string;
              campusId: string | null;
              effectiveFrom: string;
              effectiveTo: string | null;
            }>,
          ) => void;
        };
      }
    ).sessions.set([
      {
        id: 'session-1',
        classId: 'class-1',
        className: '數學 A',
        courseId: 'course-1',
        courseName: '數學',
        campusId: 'campus-1',
        campusName: '中正分校',
        sessionDate: '2026-04-01',
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
        classId: 'class-2',
        className: '英文 B',
        courseId: 'course-2',
        courseName: '英文',
        campusId: 'campus-1',
        campusName: '中正分校',
        sessionDate: '2026-04-01',
        startTime: '13:00',
        endTime: '15:00',
        teacherId: null,
        teacherName: null,
        status: 'scheduled',
        assignmentStatus: 'unassigned',
        hasChanges: false,
      },
    ]);
    (
      component as unknown as {
        selectedStudentIds: { set: (value: string[]) => void };
      }
    ).selectedStudentIds.set(['student-1']);
    (
      component as unknown as {
        studentEnrolledClassIds: { set: (value: Set<string>) => void };
      }
    ).studentEnrolledClassIds.set(new Set(['class-2']));
    (
      component as unknown as {
        studentFilteredEnrollments: {
          set: (
            value: Array<{
              classId: string;
              campusId: string | null;
              effectiveFrom: string;
              effectiveTo: string | null;
            }>,
          ) => void;
        };
      }
    ).studentFilteredEnrollments.set([
      {
        classId: 'class-2',
        campusId: 'campus-1',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ]);

    const displayedSessions = (
      component as unknown as { displayedSessions: () => Session[] }
    ).displayedSessions();

    expect(displayedSessions).toEqual([expect.objectContaining({ id: 'session-2' })]);
  });

  /**
   * **#637：交付條件不是「元件有測試」，是「有人走得到」。**
   *
   * `session-makeup-dialog` 自己有 6 支測試而且全綠 —— 但那些測的是**對話框內部**
   * （給 input、驗輸出、驗撞 409 會重載清單）。**全部都是真的，而如果沒有人能
   * 走到那裡，功能等於沒交付，且所有 gate 照樣綠。**
   *
   * 這兩條測的是**入口**：選單裡有沒有那一項、點下去會不會真的開那支對話框。
   * 這是這一席 charter 坑 #1（選單與路由表之間的縫）在對話框上的版本 ——
   * 那邊有 `app.routes.spec.ts` 當安全網，對話框這邊在 #637 之前沒有。
   */
  function makeSession(overrides: Partial<Session> = {}): Session {
    return {
      id: '00000000-0000-0000-0000-0000000000f1',
      classId: '00000000-0000-0000-0000-0000000000f2',
      className: '數學 A',
      courseId: '00000000-0000-0000-0000-0000000000f3',
      courseName: '數學',
      campusId: '00000000-0000-0000-0000-0000000000f4',
      campusName: '示範分校',
      sessionDate: '2026-09-10',
      startTime: '19:00',
      endTime: '21:00',
      teacherId: null,
      teacherName: null,
      status: 'scheduled',
      assignmentStatus: 'unassigned',
      hasChanges: false,
      ...overrides,
    } as Session;
  }

  function menuFor(session: Session) {
    (
      component as unknown as { contextSession: { set: (value: Session) => void } }
    ).contextSession.set(session);
    return (
      component as unknown as {
        contextMenuItems: () => Array<{ label?: string; command?: () => void }>;
      }
    ).contextMenuItems();
  }

  it('已排定的課堂，選單裡有「指定為補課」而且點得開對話框', () => {
    const dialogOpenSpy = vi
      .spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      )
      .mockReturnValue({ onClose: of(undefined) });

    const session = makeSession();
    const entry = menuFor(session).find((i) => i.label === '指定為補課');

    // ① 入口存在
    expect(entry).toBeDefined();

    // ② 點下去真的開那一支 —— 不是「有一個 label 長得像入口」
    entry!.command!();
    expect(dialogOpenSpy).toHaveBeenCalledWith(
      SessionMakeupDialogComponent,
      expect.objectContaining({ data: expect.objectContaining({ session }) }),
    );
  });

  /**
   * 已經指定過的課堂，入口改口說「改指定補課」（對話框會多一顆解除連結）。
   * 兩種文字都要是入口 —— 只驗其中一種的話，另一種壞掉不會有人知道。
   */
  it('已指定過的課堂，入口變成「改指定補課」', () => {
    const withLink = makeSession({
      makeupFor: { id: 'x', sessionDate: '2026-09-04', status: 'cancelled' },
    });

    expect(menuFor(withLink).map((i) => i.label)).toContain('改指定補課');
    expect(menuFor(withLink).map((i) => i.label)).not.toContain('指定為補課');
  });

  /**
   * **停課的那一堂是「被補的一方」，它自己不該有這個入口。**
   * 心智模型是「在補課的那堂課上指定它補的是哪一堂停課」（#499 裁定），
   * 而停課 toast 也是這樣寫的 —— 兩邊必須一致，否則使用者照 toast 去找會找不到。
   */
  it('停課的課堂沒有這個入口 —— 它是被補的一方', () => {
    const labels = menuFor(makeSession({ status: 'cancelled' })).map((i) => i.label);

    expect(labels).not.toContain('指定為補課');
    expect(labels).not.toContain('改指定補課');
  });

  it('adds history entry to context menu and opens session history dialog', () => {
    const session = {
      id: '00000000-0000-0000-0000-000000000021',
      classId: '00000000-0000-0000-0000-000000000022',
      className: '國文 A',
      courseId: '00000000-0000-0000-0000-000000000023',
      courseName: '國文課',
      campusId: '00000000-0000-0000-0000-000000000024',
      campusName: '示範分校',
      sessionDate: '2026-03-18',
      startTime: '09:00',
      endTime: '11:00',
      teacherId: '00000000-0000-0000-0000-000000000025',
      teacherName: '王老師',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      hasChanges: true,
    } as Session;

    (
      component as unknown as {
        contextSession: { set: (value: Session) => void };
      }
    ).contextSession.set(session);

    const dialogOpenSpy = vi
      .spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      )
      .mockReturnValue({ onClose: of(undefined) });

    const menuItems = (
      component as unknown as {
        contextMenuItems: () => Array<{ label?: string; command?: () => void }>;
      }
    ).contextMenuItems();
    const detailItem = menuItems.find((item) => item.label === '查看異動紀錄');

    expect(detailItem).toBeDefined();
    detailItem?.command?.();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      SessionDetailDialogComponent,
      expect.objectContaining({
        // 這支的 header **會渲染**（沒有 showHeader: false），所以斷言它是有意義的。
        // 刻意不叫「操作紀錄」—— 那是頁面層那顆按鈕，開的是全部課堂（#448）
        header: '課堂異動紀錄',
        data: expect.objectContaining({ session }),
      }),
    );
  });

  it('adds attendance entry to context menu and opens attendance dialog', () => {
    const session = {
      id: '00000000-0000-0000-0000-000000000031',
      classId: '00000000-0000-0000-0000-000000000032',
      className: '數學 B',
      courseId: '00000000-0000-0000-0000-000000000033',
      courseName: '數學課',
      campusId: '00000000-0000-0000-0000-000000000034',
      campusName: '示範分校',
      sessionDate: '2026-03-18',
      startTime: '14:00',
      endTime: '16:00',
      teacherId: '00000000-0000-0000-0000-000000000035',
      teacherName: '林老師',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      hasChanges: false,
      eventId: 'event-1',
    } as Session & { eventId: string };

    (
      component as unknown as {
        contextSession: { set: (value: Session) => void };
      }
    ).contextSession.set(session);

    const dialogOpenSpy = vi
      .spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      )
      .mockReturnValue({ onClose: of(undefined) });

    const menuItems = (
      component as unknown as {
        contextMenuItems: () => Array<{ label?: string; command?: () => void }>;
      }
    ).contextMenuItems();
    const attendanceItem = menuItems.find((item) => item.label === '管理出勤狀況');

    expect(attendanceItem).toBeDefined();
    attendanceItem?.command?.();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      AttendanceRosterPanelComponent,
      expect.objectContaining({
        // showHeader: false + closable: false —— 元件自己畫標頭跟關閉鈕，
        // 不能讓 PrimeNG 的 dialog chrome 再疊一層，否則會出現兩個 ×（P1 修正）
        showHeader: false,
        closable: false,
        // 直接給 eventId —— 列表那一支（/api/sessions，#950）就帶回來了，不必讓對話框再查一次
        data: expect.objectContaining({
          eventId: 'event-1',
          className: '數學 B',
          eventDate: '2026-03-18',
          timeRange: '14:00–16:00',
        }),
      }),
    );
  });

  // 停課的課堂後端刻意不補建出勤事件 —— 入口就該關掉，而不是開了才說載入失敗
  it('停課的課堂不給點名入口', () => {
    const cancelled = {
      id: '00000000-0000-0000-0000-000000000041',
      classId: '00000000-0000-0000-0000-000000000032',
      className: '數學 B',
      sessionDate: '2026-03-18',
      startTime: '14:00',
      endTime: '16:00',
      status: 'cancelled',
      assignmentStatus: 'assigned',
      hasChanges: false,
      eventId: null,
    } as unknown as Session;

    (
      component as unknown as { contextSession: { set: (value: Session) => void } }
    ).contextSession.set(cancelled);

    const item = (
      component as unknown as {
        contextMenuItems: () => Array<{ label?: string; disabled?: boolean }>;
      }
    )
      .contextMenuItems()
      .find((i) => i.label === '管理出勤狀況');

    expect(item?.disabled).toBe(true);
  });

  // 只有 `null`（停課）才鎖 —— 沒帶 eventId 的列不該被當成停課（判準是 `=== null` 不是 falsy）
  it('沒帶 eventId 的課堂不會被誤鎖', () => {
    const unknown_ = {
      id: '00000000-0000-0000-0000-000000000042',
      classId: '00000000-0000-0000-0000-000000000032',
      className: '數學 B',
      sessionDate: '2026-03-18',
      startTime: '14:00',
      endTime: '16:00',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      hasChanges: false,
    } as Session;

    (
      component as unknown as { contextSession: { set: (value: Session) => void } }
    ).contextSession.set(unknown_);

    const item = (
      component as unknown as {
        contextMenuItems: () => Array<{ label?: string; disabled?: boolean }>;
      }
    )
      .contextMenuItems()
      .find((i) => i.label === '管理出勤狀況');

    expect(item?.disabled).toBe(false);
  });

  it('syncs session list attendance summary after attendance dialog saves', () => {
    const session = {
      id: '00000000-0000-0000-0000-000000000031',
      classId: '00000000-0000-0000-0000-000000000032',
      className: '數學 B',
      courseId: '00000000-0000-0000-0000-000000000033',
      courseName: '數學課',
      campusId: '00000000-0000-0000-0000-000000000034',
      campusName: '示範分校',
      sessionDate: '2026-03-18',
      startTime: '14:00',
      endTime: '16:00',
      teacherId: '00000000-0000-0000-0000-000000000035',
      teacherName: '林老師',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      hasChanges: false,
      attendanceTakenAt: null,
      attendanceEnrolledCount: 12,
      attendancePresentCount: 0,
      attendanceOnLeaveCount: 0,
      attendanceAbsentCount: 0,
      eventId: 'event-1',
    } as Session & { eventId: string };

    (
      component as unknown as {
        sessions: { set: (value: Session[]) => void };
        openAttendance: (session: Session) => void;
      }
    ).sessions.set([session]);

    vi.spyOn(
      (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
        .dialogService,
      'open',
    ).mockReturnValue({
      onClose: of({
        eventId: 'event-1',
        takenAt: '2026-03-18T16:05:00.000Z',
        presentCount: 9,
        absentCount: 2,
        onLeaveCount: 1,
      }),
    });

    (
      component as unknown as {
        openAttendance: (session: Session) => void;
      }
    ).openAttendance(session);

    expect((component as unknown as { sessions: () => Session[] }).sessions()[0]).toEqual(
      expect.objectContaining({
        attendanceTakenAt: '2026-03-18T16:05:00.000Z',
        attendancePresentCount: 9,
        attendanceAbsentCount: 2,
        attendanceOnLeaveCount: 1,
        attendanceEnrolledCount: 12,
      }),
    );
  });

  it('opens combined operations log dialog from sessions page', () => {
    const dialogOpenSpy = vi.spyOn(
      (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
        .dialogService,
      'open',
    );

    (
      component as unknown as {
        openOperationsLog: () => void;
      }
    ).openOperationsLog();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      SessionOperationsLogDialogComponent,
      expect.objectContaining({
        // `showHeader: false`，標題來自元件模板；這裡只驗開的是哪一支對話框
        showHeader: false,
      }),
    );
  });

  it('context menu should not include leave roster entry', () => {
    (
      component as unknown as {
        contextSession: { set: (value: Session) => void };
      }
    ).contextSession.set({
      id: 'session-1',
      classId: 'class-1',
      className: 'A班',
      courseId: 'course-1',
      courseName: '英文課',
      campusId: 'campus-1',
      campusName: '示範分校',
      sessionDate: '2026-04-02',
      startTime: '14:00',
      endTime: '16:00',
      teacherId: null,
      teacherName: null,
      status: 'scheduled',
      assignmentStatus: 'unassigned',
      hasChanges: false,
    } as Session);

    const labels = (
      component as unknown as {
        contextMenuItems: () => Array<{ label?: string }>;
      }
    )
      .contextMenuItems()
      .map((item) => item.label)
      .filter(Boolean);

    expect(labels).not.toContain('查看請假名單');
  });

  it('openBatchSheet should show skip reason in toast when sessions are skipped', async () => {
    const mockResult = {
      action: 'applied' as const,
      mode: 'cancel' as const,
      updated: 3,
      skipped: 2,
    };

    const dialogOpenSpy = vi
      .spyOn(
        (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
          .dialogService,
        'open',
      )
      .mockReturnValue({ onClose: of(mockResult) });

    const messageAddSpy = vi.spyOn(
      (component as unknown as { messageService: { add: (...args: unknown[]) => void } })
        .messageService,
      'add',
    );

    (component as unknown as { openBatchSheet: () => void }).openBatchSheet();
    await fixture.whenStable();

    expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
    expect(messageAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('已停課的課堂無法重複操作'),
      }),
    );
  });

  it('openBatchSheet should not show skip reason when no sessions are skipped', async () => {
    const mockResult = {
      action: 'applied' as const,
      mode: 'cancel' as const,
      updated: 5,
      skipped: 0,
    };

    vi.spyOn(
      (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } })
        .dialogService,
      'open',
    ).mockReturnValue({ onClose: of(mockResult) });

    const messageAddSpy = vi.spyOn(
      (component as unknown as { messageService: { add: (...args: unknown[]) => void } })
        .messageService,
      'add',
    );

    (component as unknown as { openBatchSheet: () => void }).openBatchSheet();
    await fixture.whenStable();

    expect(messageAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: '已停課 5 堂',
      }),
    );
  });

  it('monthUnassignedCount should reflect value set from API', () => {
    (
      component as unknown as { monthUnassignedCount: { set: (v: number) => void } }
    ).monthUnassignedCount.set(2);

    const count = (
      component as unknown as { monthUnassignedCount: { (): number } }
    ).monthUnassignedCount();
    expect(count).toBe(2);
  });

  it('onFilterUnassigned should set selectedTeacherIds to __unassigned__', () => {
    (component as unknown as { onFilterUnassigned: () => void }).onFilterUnassigned();

    const ids = (
      component as unknown as { selectedTeacherIds: { (): string[] } }
    ).selectedTeacherIds();
    expect(ids).toEqual(['__unassigned__']);
  });

  // #950：出勤摘要、eventId、被藏起來的停課數都跟著 `/api/sessions` 一支回來 ——
  // 原本是 sessions → attendance/sessions → sessions?statuses=cancelled 三段依序請求
  it('一支請求拿齊：列表的出勤欄位與停課數直接用 /api/sessions 的回應', () => {
    const row = {
      id: 'session-1',
      classId: 'class-1',
      className: 'A班',
      courseId: 'course-1',
      courseName: '數學',
      campusId: 'campus-1',
      campusName: '示範分校',
      sessionDate: '2026-04-08',
      startTime: '09:00',
      endTime: '11:00',
      teacherId: 'teacher-1',
      teacherName: '王老師',
      status: 'scheduled',
      assignmentStatus: 'assigned',
      hasChanges: false,
      eventId: 'event-1',
      attendanceTakenAt: '2026-04-08T11:05:00.000Z',
      attendanceEnrolledCount: 10,
      attendancePresentCount: 8,
    } as Session;
    const response = makeListResponse([row]);
    sessionsServiceMock.list.mockReturnValueOnce(
      of({ ...response, meta: { ...response.meta, hiddenCancelledCount: 3 } }),
    );
    sessionsServiceMock.list.mockClear();

    (component as unknown as { onStatusesChange: (value: string[]) => void }).onStatusesChange([
      'scheduled',
    ]);

    expect(sessionsServiceMock.list).toHaveBeenCalledTimes(1);
    expect(attendanceServiceMock.sessions).not.toHaveBeenCalled();
    expect((component as unknown as { sessions: () => Session[] }).sessions()[0]).toEqual(row);
    expect(
      (component as unknown as { hiddenCancelledCount: () => number }).hiddenCancelledCount(),
    ).toBe(3);
  });

  /**
   * **#788：取數失敗時畫面不能渲染成「尚未有資料」。**
   * 斷言**畫面主體**而不是某個 signal —— 使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」而不是「此期間沒有課堂」', () => {
    sessionsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
    (component as unknown as { loadSessions: () => void }).loadSessions();
    if (vi.isFakeTimers()) vi.advanceTimersByTime(1000);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('此期間沒有課堂');
  });
  /**
   * #1314 S3 PR-B：「全部異動」抽屜。**開關只由網址的 fragment 決定** ——
   * 斷言畫面上的 `<dialog>` 開了沒，不斷言頁面的 signal。
   */
  describe('#changes 抽屜', () => {
    const drawer = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        'app-schedule-changes-drawer dialog',
      ) as HTMLDialogElement;
    // jsdom 沒有 <dialog> 的 modal 行為：只補開關狀態與 close 事件（瀏覽器關掉時會發）
    const proto = HTMLDialogElement.prototype;
    const original = { showModal: proto.showModal, close: proto.close };
    beforeEach(() => {
      proto.showModal = function (this: HTMLDialogElement) {
        this.open = true;
      };
      proto.close = function (this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
    });
    afterEach(() => Object.assign(proto, original));

    const moreItems = () =>
      (
        component as unknown as {
          moreMenuItems: () => { label?: string; command?: (e: never) => void }[];
        }
      ).moreMenuItems();
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('沒有 hash 時抽屜是關的', async () => {
      await settle();
      expect(drawer().open).toBe(false);
    });

    it('#changes 開抽屜，hash 拿掉就關（返回鍵走這條）', async () => {
      routeFragment.next('changes');
      await settle();
      expect(drawer().open).toBe(true);
      expect(drawer().textContent).toContain('全部異動');

      routeFragment.next(null);
      await settle();
      expect(drawer().open).toBe(false);
    });

    it('別的 hash 不開', async () => {
      routeFragment.next('something-else');
      await settle();
      expect(drawer().open).toBe(false);
    });

    it('從課表內點入口開的（push 過一筆歷史）：關閉＝返回上一筆，不是再 push', async () => {
      const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => undefined);
      const navigate = vi.spyOn(router, 'navigate');
      await settle();
      routeFragment.next('changes'); // 第一個 null 之後的 true ＝使用者點了入口
      await settle();

      drawer().close();
      await settle();

      expect(back).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('直接帶 #changes 進來的：關閉＝原地把 hash 拿掉（返回會離開這一頁，不能用）', async () => {
      TestBed.resetTestingModule();
      routeFragment.next('changes'); // 元件建立時就已經有 hash
      await TestBed.configureTestingModule({
        imports: [SessionsPage],
        providers: [
          MessageService,
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: {
              fragment: routeFragment.asObservable(),
              get snapshot() {
                return { queryParams: {} };
              },
            },
          },
          { provide: ReferenceDataService, useValue: refDataMock },
          { provide: CoursesService, useValue: { list: () => of({ data: [] }) } },
          { provide: ClassesService, useValue: { list: () => of({ data: [] }) } },
          { provide: SessionsService, useValue: sessionsServiceMock },
          { provide: AttendanceService, useValue: attendanceServiceMock },
          { provide: StudentsService, useValue: studentsServiceMock },
          { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        ],
      }).compileComponents();
      const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => undefined);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      fixture = TestBed.createComponent(SessionsPage);
      fixture.componentRef.setInput('page', {
        label: 'Test',
        relativePath: '',
        absolutePath: '',
        role: undefined,
        icon: '',
        showInMenu: true,
      });
      await settle();
      expect(drawer().open).toBe(true);

      drawer().close();
      await settle();

      expect(back).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ fragment: undefined, replaceUrl: true }),
      );
    });

    // #1314：入口從工具列收進「⋯」（A6 工具列沒畫它；跑馬燈沒異動時不畫，所以入口不能只靠它）
    it('「⋯」選單的「全部異動」把 fragment 設成 changes', async () => {
      await settle();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const item = moreItems().find((i) => i.label === '全部異動');
      item?.command?.({} as never);
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ fragment: 'changes', queryParamsHandling: 'preserve' }),
      );
    });

    // #1441：360px 時週日期條字黏在一起。jsdom 不跑 Tailwind，
    // 這裡釘的是意圖（手機字級），結果由 PR 的 360 實拍證明。
    it('週日期條用 A6 字級（手機 text-base、桌機 text-lg）；上下週鈕 44 見方', async () => {
      await settle();
      const el = fixture.nativeElement as HTMLElement;
      const mobile = el.querySelectorAll('[data-part="dtabs"] button b.wide\\:hidden');
      const desktop = el.querySelectorAll('[data-part="dtabs"] button b.max-wide\\:hidden');
      expect(mobile.length).toBe(6);
      expect(desktop.length).toBe(6);
      for (const b of Array.from(mobile)) expect(b.classList.contains('text-base')).toBe(true);
      for (const b of Array.from(desktop)) expect(b.classList.contains('wide:text-lg')).toBe(true);
      for (const label of ['上一週', '下一週']) {
        const btn = el.querySelector(`button[aria-label="${label}"]`) as HTMLElement;
        expect(btn.classList.contains('size-11'), label).toBe(true);
      }
    });
  });

  /** 異動頁「看這堂」（#1314）：日視圖切到那天，**載完課表後**才打開那一堂的選單 */
  describe('focusDate／focusSession', () => {
    type F = {
      day: () => Date;
      mode: () => string;
      pendingMenuSession: () => string | null;
    };
    async function open(
      query: Record<string, string>,
      list: Subject<ReturnType<typeof makeListResponse>> | null = null,
    ) {
      TestBed.resetTestingModule();
      routeQueryParams = query;
      if (list) sessionsServiceMock.list.mockReturnValueOnce(list as never);
      await TestBed.configureTestingModule({
        imports: [SessionsPage],
        providers: [
          MessageService,
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: {
              fragment: routeFragment.asObservable(),
              get snapshot() {
                return { queryParams: routeQueryParams };
              },
            },
          },
          { provide: ReferenceDataService, useValue: refDataMock },
          { provide: CoursesService, useValue: { list: () => of({ data: [] }) } },
          { provide: ClassesService, useValue: { list: () => of({ data: [] }) } },
          { provide: SessionsService, useValue: sessionsServiceMock },
          { provide: AttendanceService, useValue: attendanceServiceMock },
          { provide: StudentsService, useValue: studentsServiceMock },
          { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
        ],
      }).compileComponents();
      const f = TestBed.createComponent(SessionsPage);
      f.componentRef.setInput('page', {
        label: 'Test',
        relativePath: '',
        absolutePath: '',
        role: undefined,
        icon: '',
        showInMenu: true,
      });
      f.detectChanges();
      return { f, c: f.componentInstance as unknown as F };
    }

    it('切到那天（固定時鐘 4/15，目標 10/20 與真實今天不同）並查那一天', async () => {
      sessionsServiceMock.list.mockClear();
      const { f, c } = await open({ focusDate: '2026-10-20', focusSession: 's-1' });
      await f.whenStable();
      expect(format(c.day(), 'yyyy-MM-dd')).toBe('2026-10-20');
      expect(c.mode()).toBe('day');
      const firstCall = sessionsServiceMock.list.mock.calls[0] as unknown as [
        { dateFrom?: string; dateTo?: string },
      ];
      expect(JSON.stringify(firstCall[0])).toContain('2026-10-20');
    });

    it('課表還沒載完時不消耗待開的那一堂；載完才消耗', async () => {
      const pending = new Subject<ReturnType<typeof makeListResponse>>();
      const { f, c } = await open({ focusDate: '2026-10-20', focusSession: 's-1' }, pending);
      await f.whenStable();
      expect(c.pendingMenuSession()).toBe('s-1');
      pending.next(makeListResponse());
      pending.complete();
      f.detectChanges();
      await f.whenStable();
      expect(c.pendingMenuSession()).toBeNull();
    });

    it('壞網址（日期不存在）：維持今天、不設待開', async () => {
      const { c } = await open({ focusDate: '2026-13-45', focusSession: 's-1' });
      expect(format(c.day(), 'yyyy-MM-dd')).toBe('2026-04-15');
      expect(c.pendingMenuSession()).toBeNull();
    });

    it('同時帶了篩選條件（結果模式）：不處理 focus', async () => {
      const { c } = await open({
        classId: 'class-1',
        focusDate: '2026-10-20',
        focusSession: 's-1',
      });
      expect(c.mode()).toBe('results');
      expect(c.pendingMenuSession()).toBeNull();
      // 待開的那堂會被 effect 消耗掉，所以光看它是 null 抓不到「沒擋」；day 沒被切走才是證據
      expect(format(c.day(), 'yyyy-MM-dd')).toBe('2026-04-15');
    });
  });

  /** #1314 課表：A6 工具列只畫日／週、日期條、快速選取，其餘收進「⋯」，數字＝待處理堂數 */
  describe('「⋯」選單', () => {
    type C = {
      monthUnassignedCount: { set: (v: number) => void };
      todayPendingAttendanceCount: { set: (v: number) => void };
      hiddenCancelledCount: { set: (v: number) => void };
      moreMenuItems: () => { label?: string; separator?: boolean }[];
    };
    const c = () => component as unknown as C;
    const labels = () =>
      c()
        .moreMenuItems()
        .map((i) => i.label);
    const badge = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '.more-menu-badge',
      ) as HTMLElement | null;
    const trigger = () =>
      (fixture.nativeElement as HTMLElement).querySelector('.more-menu-trigger') as HTMLElement;

    it('沒有待處理：沒有數字、沒有未指派／未點名項，固定項都在', () => {
      c().monthUnassignedCount.set(0);
      c().todayPendingAttendanceCount.set(0);
      fixture.detectChanges();
      expect(badge()).toBeNull();
      expect(trigger().getAttribute('aria-label')).toBe('更多');
      expect(labels()).toEqual(['全部異動', '進階篩選', '隱藏停課', '操作紀錄']);
    });

    it('門檻 1：未指派 1／未點名 0 與 未指派 0／未點名 1 各自出現；數字是兩者合計', () => {
      c().monthUnassignedCount.set(1);
      c().todayPendingAttendanceCount.set(0);
      fixture.detectChanges();
      expect(labels()).toContain('本月未指派 1 堂');
      expect(labels().some((l) => l?.includes('未點名'))).toBe(false);
      expect(badge()?.textContent?.trim()).toBe('1');

      c().monthUnassignedCount.set(0);
      c().todayPendingAttendanceCount.set(1);
      fixture.detectChanges();
      expect(labels().some((l) => l?.includes('未指派'))).toBe(false);
      expect(labels()).toContain('今日未點名 1 堂');
      expect(badge()?.textContent?.trim()).toBe('1');

      c().monthUnassignedCount.set(3);
      c().todayPendingAttendanceCount.set(2);
      fixture.detectChanges();
      expect(badge()?.textContent?.trim()).toBe('5');
      expect(trigger().getAttribute('aria-label')).toBe('更多，5 堂待處理');
    });

    it('有待辦時待辦項與固定項之間有分隔線，沒有待辦時沒有（不以分隔線開頭）', () => {
      c().monthUnassignedCount.set(1);
      fixture.detectChanges();
      expect(c().moreMenuItems()[1]?.separator).toBe(true);
      c().monthUnassignedCount.set(0);
      fixture.detectChanges();
      expect(c().moreMenuItems()[0]?.separator).toBeUndefined();
    });

    it('已隱藏 N 堂停課：色面外有揭露鈕（#640），⋯ 不再提供「隱藏停課」', () => {
      c().hiddenCancelledCount.set(0);
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.sessions-hidden-note'),
      ).toBeNull();
      c().hiddenCancelledCount.set(1);
      fixture.detectChanges();
      const note = (fixture.nativeElement as HTMLElement).querySelector('.sessions-hidden-note');
      expect(note?.textContent).toContain('已隱藏 1 堂停課');
      expect(labels()).not.toContain('隱藏停課');
    });

    it('有篩選但沒有被隱藏的停課：篩選列在、揭露鈕不在（0 堂不寫「已隱藏 0 堂」）', () => {
      c().hiddenCancelledCount.set(0);
      (
        component as unknown as { selectedTeacherIds: { set: (v: string[]) => void } }
      ).selectedTeacherIds.set(['t1']);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('清除篩選');
      expect(el.querySelector('.sessions-hidden-note')).toBeNull();
    });

    it('選了頂欄分校：待辦項寫「此分校」；沒選就不寫', () => {
      c().monthUnassignedCount.set(2);
      c().todayPendingAttendanceCount.set(3);
      expect(labels()).toContain('本月未指派 2 堂');
      expect(labels()).toContain('今日未點名 3 堂');

      refDataMock.campuses.set([{ id: 'campus-1', name: '文山旗艦校' }]);
      TestBed.inject(CampusContextService).select('campus-1');
      expect(labels()).toContain('此分校本月未指派 2 堂');
      expect(labels()).toContain('此分校今日未點名 3 堂');
    });

    it('結果模式（篩選中）不提供「隱藏停課」；日／週才有', () => {
      expect(labels()).toContain('隱藏停課');
      (component as unknown as { mode: { set: (v: string) => void } }).mode.set('results');
      expect(labels()).not.toContain('隱藏停課');
    });

    it('Hero 不再放未指派／未點名連結', () => {
      c().monthUnassignedCount.set(2);
      c().todayPendingAttendanceCount.set(2);
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-page-open')?.textContent,
      ).not.toContain('未指派');
    });
  });

  /** #1314 conformance（課表）：工具列的 A6 樣式——選中態、日期條、今天標籤、快速選取 */
  describe('A6 工具列樣式', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const viewBtn = (label: string) =>
      Array.from(el().querySelectorAll('[aria-label="檢視"] button')).find(
        (b) => b.textContent?.trim() === label,
      ) as HTMLElement;
    const setMode = (m: string) => {
      (component as unknown as { mode: { set: (v: string) => void } }).mode.set(m);
      fixture.detectChanges();
    };

    it('日／週：選中＝近黑底白字，另一顆透明＋zinc-700；切換後兩邊對調', () => {
      setMode('day');
      expect(viewBtn('日').classList.contains('bg-zinc-900')).toBe(true);
      expect(viewBtn('日').classList.contains('text-white')).toBe(true);
      expect(viewBtn('週').classList.contains('bg-transparent')).toBe(true);
      expect(viewBtn('週').classList.contains('text-zinc-700')).toBe(true);
      expect(viewBtn('週').classList.contains('bg-zinc-900')).toBe(false);

      setMode('week');
      expect(viewBtn('週').classList.contains('bg-zinc-900')).toBe(true);
      expect(viewBtn('日').classList.contains('bg-zinc-900')).toBe(false);
      expect(viewBtn('日').classList.contains('text-zinc-700')).toBe(true);
    });

    it('日／週：外框是白底的一整塊（A6 .vsw 量到 #fff、padding 2px、圓角 6px），未選那顆透明在白底上', () => {
      const group = el().querySelector('[aria-label="檢視"]')!;
      expect(group.classList.contains('bg-white')).toBe(true);
      expect(group.classList.contains('bg-zinc-100')).toBe(false);
      expect(group.classList.contains('p-0.5')).toBe(true);
      expect(group.classList.contains('rounded-md')).toBe(true);
    });

    it('日／週：手機 44、桌機 32 高（A27 只管基底），字級 text-lg', () => {
      const b = viewBtn('日');
      expect(b.classList.contains('h-11')).toBe(true);
      expect(b.classList.contains('wide:h-8')).toBe(true);
      expect(b.classList.contains('text-lg')).toBe(true);
    });

    it('日期條：選中的那天日期 zinc-900、週X zinc-700；其餘日期 zinc-700、週X zinc-500；今天是 <i>', () => {
      setMode('day');
      const tabs = Array.from(el().querySelectorAll('[data-part="dtabs"] button'));
      const sel = tabs.filter((t) => t.getAttribute('aria-current') === 'date');
      expect(sel.length).toBe(1);
      for (const t of tabs) {
        const isSel = t === sel[0];
        const b = t.querySelector('b')!;
        expect(t.classList.contains('text-zinc-700'), '選中 → 按鈕 zinc-700').toBe(isSel);
        expect(t.classList.contains('text-zinc-500'), '未選 → 按鈕 zinc-500').toBe(!isSel);
        expect(b.classList.contains('text-zinc-900')).toBe(isSel);
        expect(b.classList.contains('text-zinc-700')).toBe(!isSel);
        expect(t.classList.contains('leading-[1.25]')).toBe(true);
      }
    });

    it('「今天」標籤是 <i>（A6 role），而且只有今天那一格有', () => {
      const labels = el().querySelectorAll('[data-part="dtabs"] i');
      expect(labels.length).toBe(1); // 固定時鐘 4/15 在預設那週裡，所以一定有；0 個（改成 span）要紅
      for (const i of Array.from(labels)) {
        expect(i.textContent?.trim()).toBe('今天');
        expect(i.classList.contains('not-italic')).toBe(true);
      }
    });

    // 高度：使用者 10-15 要求跟旁邊等高（偏離 A6 的 30）；10-23 再裁定全站工具列同高 → tbar-control（#1903）
    it('快速選取：純文字（A6 沒畫圖示）、桌機跟旁邊的 ⋯／本週等高（tbar-control）；開了之後變「完成」', () => {
      const desktop = Array.from(el().querySelectorAll('button[aria-pressed]')).find((b) =>
        b.classList.contains('wide:inline-flex'),
      ) as HTMLElement;
      expect(desktop.textContent?.trim()).toBe('快速選取');
      expect(desktop.classList.contains('tbar-control')).toBe(true);
      expect(desktop.className).not.toContain('wide:h-[30px]');
      expect(desktop.querySelector('i')).toBeNull();
      expect(desktop.classList.contains('border-zinc-300')).toBe(true); // A6 桌機淺框
      expect(desktop.classList.contains('bg-transparent')).toBe(true);
      (component as unknown as { picking: { set: (v: boolean) => void } }).picking.set(true);
      fixture.detectChanges();
      expect(desktop.textContent?.trim()).toBe('完成');
      expect(desktop.getAttribute('aria-pressed')).toBe('true');
      // #1620：A6「完成」＝近黑實心＋勾
      expect(desktop.classList.contains('aria-pressed:bg-zinc-900')).toBe(true);
      expect(desktop.classList.contains('aria-pressed:text-white')).toBe(true);
      expect(desktop.querySelector('svg')).not.toBeNull();
    });

    it('手機快速選取：A6 量到的是自然寬度（不是全寬）、白底、tbar-control 高、圖示拿掉；所在列靠右', () => {
      const mobile = Array.from(el().querySelectorAll('button')).find(
        (b) => b.classList.contains('wide:hidden') && b.textContent?.includes('快速選取'),
      ) as HTMLElement;
      expect(mobile.classList.contains('flex-1')).toBe(false);
      expect(mobile.classList.contains('bg-white')).toBe(true);
      expect(mobile.classList.contains('border-zinc-900')).toBe(true); // A6 手機是近黑框（桌機是淺框）
      expect(mobile.classList.contains('tbar-control')).toBe(true);
      expect(mobile.querySelector('i')).toBeNull();
      expect(mobile.parentElement!.classList.contains('max-wide:ml-auto')).toBe(true);
    });

    it('工具列上方沒有框線（#1620 使用者裁定 2）；手機在日期條之後換行、靠右', () => {
      const tools = el().querySelector('.more-menu-trigger')!.parentElement!;
      expect(tools.classList.contains('border-t')).toBe(false);
      expect(tools.classList.contains('max-wide:order-6')).toBe(true);
      expect(tools.classList.contains('max-wide:ml-auto')).toBe(true);
      expect(
        el().querySelector('[data-part="dtabs"]')!.classList.contains('max-wide:order-2'),
      ).toBe(true);
    });
  });

  /** #1620 使用者裁定 1：週列照 A6 `.dtabs`（週一～週六、和日／週同一列），保留 ‹ › 換週 */
  describe('週列（#1620）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const tabs = () => Array.from(el().querySelectorAll('[data-part="dtabs"] button'));

    it('沒有週日的課：只有週一～週六', async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(tabs().map((t) => t.querySelector('span')?.textContent?.trim())).toEqual([
        '週一',
        '週二',
        '週三',
        '週四',
        '週五',
        '週六',
      ]);
      expect(sessionsServiceMock.hasSessionsOn.mock.calls.at(-1)?.[0]).toBe('2026-04-19');
    });

    it('這週週日有課：多一格週日（不然日視圖沒有入口）', async () => {
      sessionsServiceMock.hasSessionsOn.mockReturnValue(of(true));
      (component as unknown as { shiftWeek: (n: number) => void }).shiftWeek(1);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(sessionsServiceMock.hasSessionsOn.mock.calls.at(-1)?.[0]).toBe('2026-04-26');
      expect(tabs().at(-1)?.querySelector('span')?.textContent?.trim()).toBe('週日');
      expect(tabs()).toHaveLength(7);
    });

    it('同一週換天不重查週日', async () => {
      await fixture.whenStable();
      const n = sessionsServiceMock.hasSessionsOn.mock.calls.length;
      (tabs()[0] as HTMLElement).click();
      fixture.detectChanges();
      expect(sessionsServiceMock.hasSessionsOn.mock.calls.length).toBe(n);
    });

    it('手機日期字：第一格與跨月那天寫月/日，其餘寫日（#1441：360 寬「10/12」會黏在一起）', () => {
      const short = () =>
        tabs().map((t) => t.querySelector('b.wide\\:hidden')?.textContent?.trim());
      expect(short()).toEqual(['4/13', '14', '15', '16', '17', '18']);
      const fn = (component as unknown as { stripDateShort: (d: Date, f: boolean) => string })
        .stripDateShort;
      expect(fn(new Date(2026, 9, 1), false)).toBe('10/1');
      expect(fn(new Date(2026, 8, 28), true)).toBe('9/28');
      expect(fn(new Date(2026, 8, 29), false)).toBe('29');
      // 桌機每格都是月/日
      expect(tabs()[1].querySelector('b.max-wide\\:hidden')?.textContent?.trim()).toBe('4/14');
    });

    const thisWeekBtn = () =>
      Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === '本週');

    it('本週時沒有「本週」鈕（版面同 A6）；別週時出現在 ‹ › 旁，點了回本週並選今天', () => {
      expect(thisWeekBtn()).toBeUndefined();
      (component as unknown as { shiftWeek: (n: number) => void }).shiftWeek(-2);
      fixture.detectChanges();
      const btn = thisWeekBtn()!;
      expect(btn).toBeDefined();
      btn.click();
      fixture.detectChanges();
      expect(thisWeekBtn()).toBeUndefined();
      const day = (component as unknown as { day: () => Date }).day();
      expect(day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate()).toBe(20260415);
    });

    // #1641 項 3 審核席：「本週」一出現就把 ‹ › 往左推的話，連點下一週的第二下會落到別的按鈕上
    it('「本週」鈕在桌機排在 ‹ 之前（出現時不推動箭頭）', () => {
      (component as unknown as { shiftWeek: (n: number) => void }).shiftWeek(1);
      fixture.detectChanges();
      expect(thisWeekBtn()!.classList).toContain('wide:order-first');
    });

    // #1641 項 3 審核席：換週失敗後殘留的方向，不能被下一次非換週的重查拿去用
    it('換週查詢失敗後，非換週的重查成功不給方向', () => {
      const c = component as unknown as {
        shiftWeek: (n: number) => void;
        loadSessions: () => void;
        contentMotion: () => unknown;
      };
      sessionsServiceMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
      c.shiftWeek(1);
      expect(c.contentMotion()).toBeNull();
      c.loadSessions();
      expect(c.contentMotion()).toBeNull();
    });

    it('今天是這週的週日、但週日沒有課：週日格照樣出現', () => {
      vi.setSystemTime(new Date('2026-04-19T04:00:00Z')); // 台北週日中午
      (component as unknown as { loadSessions: () => void }).loadSessions();
      fixture.detectChanges();
      expect(sessionsServiceMock.hasSessionsOn).toHaveReturned();
      expect(tabs().at(-1)?.querySelector('span')?.textContent?.trim()).toBe('週日');
    });

    it('沒有「回到今天」、沒有日曆跳日；‹ › 換週還在', () => {
      (component as unknown as { shiftWeek: (n: number) => void }).shiftWeek(1);
      fixture.detectChanges();
      expect(el().textContent).not.toContain('回到今天');
      expect(el().querySelector('input[type="date"]')).toBeNull();
      expect(el().querySelector('[title="跳到某天"], [aria-label="跳到某天"]')).toBeNull();
      expect(el().querySelector('button[aria-label="上一週"]')).not.toBeNull();
      expect(el().querySelector('button[aria-label="下一週"]')).not.toBeNull();
    });

    it('點一天：捲到工具列（A6 schedule.js:867）', () => {
      const spy = vi.fn();
      Element.prototype.scrollIntoView = spy;
      (tabs()[0] as HTMLElement).click();
      fixture.detectChanges();
      expect(spy).toHaveBeenCalled();
    });

    it('手機面板標題帶日期：週三 4/15 · 今天（A6 qs__day）', () => {
      const title = (component as unknown as { sheetTitle: () => string }).sheetTitle;
      expect(title()).toBe('週三 4/15 · 今天');
      (tabs()[0] as HTMLElement).click();
      fixture.detectChanges();
      expect(title()).toBe('週一 4/13');
    });
  });

  /** #1314 conformance E：A6 `.pkl` 每天都印；日名除了「今天」後面有空格；全停課寫「整天停課」 */
  describe('今天最滿一行', () => {
    const line = () =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="peak-line"]',
      ) as HTMLElement | null;
    const flat = () => line()?.textContent?.replace(/\s+/g, ' ').trim();
    const sess = (over: Record<string, unknown>) =>
      ({
        id: 's1',
        sessionDate: '2026-04-15',
        startTime: '17:00:00',
        endTime: '18:00:00',
        status: 'scheduled',
        teacherId: 't1',
        teacherName: '甲',
        className: '國二數學',
        classId: 'c1',
        assignmentStatus: 'assigned',
        ...over,
      }) as never;
    async function show(list: unknown[]) {
      sessionsServiceMock.list.mockReturnValue(of(makeListResponse(list as never)));
      (component as unknown as { loadSessions: () => void }).loadSessions();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('一堂：今天（固定時鐘 4/15）→「今天最滿 17:00–18:00 · 同時 1 班」，日名後沒有空格', async () => {
      await show([sess({})]);
      expect(flat()).toBe('今天最滿 17:00–18:00 · 同時 1 班');
    });

    it('兩堂同時：同時 2 班；非今天的日子日名後有一個空格', async () => {
      await show([sess({ id: 'a' }), sess({ id: 'b', teacherId: 't2' })]);
      expect(flat()).toContain('同時 2 班');
      (component as unknown as { day: { set: (d: Date) => void } }).day.set(
        new Date('2026-04-16T00:00:00'),
      );
      fixture.detectChanges();
      expect(flat()).toMatch(/^週四 4\/16 最滿/);
    });

    // conformance F：A6 `.gb__main` padding-right 30、`.gb__name／.gb__meta` 行高 1.3、軸列「老師」標籤內距 8／12
    it('甘特課塊：右內距 30（留給 ⋯）、班名與時間行高 1.3；軸列標籤上下 8、右 12', async () => {
      await show([sess({})]);
      const root = fixture.nativeElement as HTMLElement;
      const block = root.querySelector(
        'app-schedule-gantt button[data-session-menu]',
      ) as HTMLElement;
      expect(block.classList.contains('pr-[30px]')).toBe(true);
      const [name, meta] = Array.from(block.querySelectorAll(':scope > span'));
      expect(name.classList.contains('leading-[1.3]')).toBe(true);
      expect(meta.classList.contains('leading-[1.3]')).toBe(true);
      const axis = Array.from(root.querySelectorAll('app-schedule-gantt div')).find(
        (d) => d.textContent?.trim() === '老師',
      ) as HTMLElement;
      expect(axis.classList.contains('py-2')).toBe(true);
      expect(axis.classList.contains('pr-3')).toBe(true);
    });

    it('全部停課：「整天停課」，不寫最滿', async () => {
      await show([sess({ status: 'cancelled' })]);
      expect(flat()).toBe('今天整天停課');
    });
  });

  /** conformance：色面標題兩行（A6「…堂課，<br>…堂有異動。」）；篩選結果那句不拆 */
  describe('色面標題兩行', () => {
    // 課表頁有沒有傳 compact 沒有別的東西在守（page-open 元件本身的 spec 只守「有傳會怎樣」）
    it('課表的色面開了 compact：標題 40／26、內距上 32／下 24（A6 schedule.css:10-11,277）', () => {
      const el = fixture.nativeElement as HTMLElement;
      const h1 = el.querySelector('app-page-open h1') as HTMLElement;
      expect(h1.classList.contains('wide:text-[40px]')).toBe(true);
      expect(h1.classList.contains('text-[26px]')).toBe(true);
      expect(h1.classList.contains('wide:text-[48px]')).toBe(false);
      const wrap = el.querySelector('app-page-open section > div.page-wrap') as HTMLElement;
      expect(wrap.classList.contains('pt-8')).toBe(true);
      expect(wrap.classList.contains('pb-6')).toBe(true);
    });

    const h1 = () => (fixture.nativeElement as HTMLElement).querySelector('h1') as HTMLElement;
    it('日／週：逗號後換行（一個 <br>）；文字內容連起來仍是原句', async () => {
      sessionsServiceMock.list.mockReturnValue(
        of(
          makeListResponse([
            {
              id: 's1',
              sessionDate: '2026-04-15',
              startTime: '17:00:00',
              endTime: '18:00:00',
              status: 'scheduled',
              teacherId: 't1',
              teacherName: '甲',
              className: '國二數學',
              classId: 'c1',
              assignmentStatus: 'assigned',
            } as never,
          ]),
        ),
      );
      (component as unknown as { loadSessions: () => void }).loadSessions();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(h1().querySelectorAll('br').length).toBe(1);
      expect(h1().textContent?.replace(/\s+/g, '')).toBe('今天1堂課，沒有異動。');
    });
    it('篩選結果：不拆行', async () => {
      (component as unknown as { mode: { set: (v: string) => void } }).mode.set('results');
      fixture.detectChanges();
      expect(h1().querySelectorAll('br').length).toBe(0);
    });
  });
});
