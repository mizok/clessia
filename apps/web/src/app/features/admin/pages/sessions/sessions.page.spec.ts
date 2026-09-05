import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
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
import { SessionAdvancedFiltersDialogComponent } from '@shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

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

  it('starts with empty date range and no active filters on init', async () => {
    await fixture.whenStable();

    const listDateRange = (component as unknown as { listDateRange: () => Date[] }).listDateRange();
    const activeFilterCount = (
      component as unknown as { activeFilterCount: () => number }
    ).activeFilterCount();
    const hasActiveFilters = (
      component as unknown as { hasActiveFilters: () => boolean }
    ).hasActiveFilters();

    expect(listDateRange).toHaveLength(2);
    expect(activeFilterCount).toBe(0);
    expect(hasActiveFilters).toBe(false);
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
    expect(sessionsServiceMock.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        campusIds: ['campus-1'],
        courseIds: ['course-1'],
        teacherIds: ['teacher-1'],
        classIds: ['class-1'],
        statuses: ['completed'],
        page: 1,
      }),
    );
  });

  it('treats empty status selection as all statuses', () => {
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
        pageSize: LIST_PAGE_SIZE,
      }),
    );
  });

  it('keeps filters in memory without syncing query params', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

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
      statuses: undefined,
      page: 1,
      pageSize: LIST_PAGE_SIZE,
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
        header: '異動紀錄',
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
        header: '管理出勤狀況',
        closable: true,
        // 直接給 eventId —— 列表 merge 時就配對到了，不必讓對話框再打一次同一支 API
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

  // eventId 是 undefined 代表出勤摘要那支 API 沒回來 —— 那是「還不知道」不是「不能點」
  it('出勤摘要還沒到的課堂不會被誤鎖', () => {
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
        header: '操作紀錄',
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

  it('onPageChange should call sessions API with the new page number', () => {
    sessionsServiceMock.list.mockClear();

    (component as unknown as { onPageChange: (page: number) => void }).onPageChange(2);

    expect(sessionsServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: LIST_PAGE_SIZE }),
    );
  });

  it('onPageChange should update currentPage signal', () => {
    (component as unknown as { onPageChange: (page: number) => void }).onPageChange(3);

    const page = (component as unknown as { currentPage: { (): number } }).currentPage();
    expect(page).toBe(3);
  });

  it('enriches sessions with attendance summary for session list display', () => {
    sessionsServiceMock.list.mockReturnValueOnce(
      of(
        makeListResponse([
          {
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
          },
        ]),
      ),
    );
    attendanceServiceMock.sessions.mockReturnValueOnce(
      of({
        data: [
          {
            eventId: 'event-1',
            sessionId: 'session-1',
            status: 'scheduled',
            isSubstitute: false,
            examCount: 0,
            classId: 'class-1',
            className: 'A班',
            usesContactBook: false,
            courseName: '數學',
            teacherName: '王老師',
            campusId: 'campus-1',
            campusName: '示範分校',
            eventDate: '2026-04-08',
            startTime: '09:00',
            endTime: '11:00',
            enrolledCount: 10,
            presentCount: 8,
            onLeaveCount: 1,
            absentCount: 1,
            takenAt: '2026-04-08T11:05:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, pageSize: 1000, totalPages: 1 },
      }),
    );

    (component as unknown as { loadSessions: () => void }).loadSessions();

    expect(attendanceServiceMock.sessions).toHaveBeenCalledWith(
      expect.objectContaining({
        classIds: ['class-1'],
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
        page: 1,
        pageSize: 100,
      }),
    );
    expect(
      (
        component as unknown as {
          sessions: {
            (): Array<
              Session & { attendanceTakenAt?: string | null; attendancePresentCount?: number }
            >;
          };
        }
      ).sessions()[0],
    ).toEqual(
      expect.objectContaining({
        attendanceTakenAt: '2026-04-08T11:05:00.000Z',
        attendancePresentCount: 8,
      }),
    );
  });
});
