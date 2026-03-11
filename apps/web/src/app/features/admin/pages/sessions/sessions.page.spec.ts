import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ClassesService } from '@core/classes.service';
import { CoursesService } from '@core/courses.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type Session } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';

import { SessionsPage } from './sessions.page';
import { SessionAssignDialogComponent } from './dialogs/session-assign-dialog/session-assign-dialog.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';

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

  beforeEach(async () => {
    routeQueryParams = {};
    sessionsServiceMock.list.mockClear();
    sessionsServiceMock.batchAssignTeacher.mockClear();
    sessionsServiceMock.batchUpdateTime.mockClear();
    sessionsServiceMock.batchCancel.mockClear();
    sessionsServiceMock.batchUncancel.mockClear();

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

    (component as unknown as { openAssignSingle: (target: Session) => void }).openAssignSingle(session);

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
        courses: { set: (value: Array<{ id: string; campusId: string; subjectId: string }>) => void };
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
        isActive: true,
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
        isActive: true,
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

    const listDateRange = (
      component as unknown as { listDateRange: () => Date[] }
    ).listDateRange();
    const activeFilterCount = (
      component as unknown as { activeFilterCount: () => number }
    ).activeFilterCount();
    const hasActiveFilters = (
      component as unknown as { hasActiveFilters: () => boolean }
    ).hasActiveFilters();

    expect(listDateRange).toHaveLength(0);
    expect(activeFilterCount).toBe(0);
    expect(hasActiveFilters).toBe(false);
  });

  it('counts campus filter as an active filter and clears it with clearFilters', () => {
    (
      component as unknown as {
        selectedCampusIds: { set: (value: string[]) => void };
        clearFilters: () => void;
      }
    ).selectedCampusIds.set(['campus-1']);

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
    const activeFilterCountAfterClear = (
      component as unknown as { activeFilterCount: () => number }
    ).activeFilterCount();
    const hasActiveFiltersAfterClear = (
      component as unknown as { hasActiveFilters: () => boolean }
    ).hasActiveFilters();

    expect(activeFilterCountBeforeClear).toBe(1);
    expect(hasActiveFiltersBeforeClear).toBe(true);
    expect(selectedCampusIdsAfterClear).toEqual([]);
    expect(activeFilterCountAfterClear).toBe(0);
    expect(hasActiveFiltersAfterClear).toBe(false);
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
        pageSize: 20,
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
      pageSize: 20,
    });
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
      component as unknown as { contextMenuItems: () => Array<{ label?: string; command?: () => void }> }
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
      (component as unknown as { messageService: { add: (...args: unknown[]) => void } }).messageService,
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
      (component as unknown as { dialogService: { open: (...args: unknown[]) => unknown } }).dialogService,
      'open',
    ).mockReturnValue({ onClose: of(mockResult) });

    const messageAddSpy = vi.spyOn(
      (component as unknown as { messageService: { add: (...args: unknown[]) => void } }).messageService,
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

  it('unassignedCount should reflect value set from API', () => {
    (component as unknown as { unassignedCount: { set: (v: number) => void } }).unassignedCount.set(2);

    const count = (component as unknown as { unassignedCount: { (): number } }).unassignedCount();
    expect(count).toBe(2);
  });

  it('onFilterUnassigned should set selectedTeacherIds to __unassigned__', () => {
    (component as unknown as { onFilterUnassigned: () => void }).onFilterUnassigned();

    const ids = (component as unknown as { selectedTeacherIds: { (): string[] } }).selectedTeacherIds();
    expect(ids).toEqual(['__unassigned__']);
  });

  it('onPageChange should call sessions API with the new page number', () => {
    sessionsServiceMock.list.mockClear();

    (component as unknown as { onPageChange: (page: number) => void }).onPageChange(2);

    expect(sessionsServiceMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 20 }),
    );
  });

  it('onPageChange should update currentPage signal', () => {
    (component as unknown as { onPageChange: (page: number) => void }).onPageChange(3);

    const page = (component as unknown as { currentPage: { (): number } }).currentPage();
    expect(page).toBe(3);
  });
});
