import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { parseISO } from 'date-fns';
import { AttendanceService, type AttendanceSessionListResponse } from '@core/attendance.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService } from '@core/courses.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type Session } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { StudentsService } from '@core/students.service';

import { SessionsPage } from './sessions.page';
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
    sessionsServiceMock.list.mockClear();
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
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
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
    (
      component as unknown as {
        selectedCampusIds: { set: (value: string[]) => void };
        selectedCourseIds: { set: (value: string[]) => void };
      }
    ).selectedCampusIds.set(['campus-1']);
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

  it('換天：只查那一天、放掉勾選', () => {
    const c = component as unknown as {
      setDay: (d: Date) => void;
      selectedIds: { set: (v: Set<string>) => void; (): Set<string> };
    };
    c.selectedIds.set(new Set(['s1']));
    c.setDay(new Date(2026, 9, 6));
    expect(c.selectedIds().size).toBe(0);
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-06', to: '2026-10-06' }),
    );
  });

  it('週視圖：查週一到週日、放掉勾選；上下週留在週視圖；點一天切回那天的日視圖', () => {
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
    expect(c.selectedIds().size).toBe(0);
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
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
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
    (
      component as unknown as {
        selectedCampusIds: { set: (value: string[]) => void };
        listDateRange: { set: (value: Date[]) => void };
        selectedCourseIds: { set: (value: string[]) => void };
        selectedStatuses: { set: (value: string[]) => void };
        clearFilters: () => void;
      }
    ).selectedCampusIds.set(['campus-1']);
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
    (
      component as unknown as {
        selectedCampusIds: { set: (value: string[]) => void };
      }
    ).selectedCampusIds.set(['campus-1']);

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

    (
      component as unknown as {
        selectedCampusIds: { set: (value: string[]) => void };
        listDateRange: { set: (value: Date[]) => void };
      }
    ).selectedCampusIds.set(['campus-1', 'campus-2']);
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
      campusIds: ['campus-1', 'campus-2'],
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
});
