import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DialogService } from 'primeng/dynamicdialog';
import { AttendancePage } from './attendance.page';
import { AttendanceService } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService } from '@core/courses.service';
import { StudentsService } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { SessionAdvancedFiltersDialogComponent } from '@shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component';

describe('AttendancePage', () => {
  let component: AttendancePage;
  let fixture: ComponentFixture<AttendancePage>;
  let localDialogService: DialogService;

  const attendanceServiceMock = {
    sessions: vi.fn(() =>
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
      }),
    ),
  };
  const orgSettingsServiceMock = {
    settings: signal(null),
    getSettings: vi.fn(() =>
      of({
        id: 'org-1',
        name: '測試補習班',
        attendanceMode: 'per_session' as const,
        attendanceResponsible: 'admin' as const,
        attendanceRetroactiveDays: 0,
      }),
    ),
  };
  const dialogServiceMock = {
    open: vi.fn(),
  };
  const overlayContainerServiceMock = {
    getContainer: vi.fn(() => null),
  };
  const campusesServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'campus-1',
            orgId: 'org-1',
            name: '中正分校',
            address: null,
            phone: null,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'campus-2',
            orgId: 'org-1',
            name: '大安分校',
            address: null,
            phone: null,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        summary: {},
        meta: {},
      }),
    ),
  };
  const studentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        summary: { total: 0, activeCount: 0 },
        meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
      }),
    ),
  };
  const coursesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };
  const classesServiceMock = {
    list: vi.fn(() => of({ data: [] })),
  };
  const enrollmentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [] as Array<{ classId: string }>,
        meta: { total: 0, page: 1, pageSize: 200, totalPages: 1 },
      }),
    ),
  };

  beforeEach(async () => {
    attendanceServiceMock.sessions.mockClear();
    campusesServiceMock.list.mockClear();
    studentsServiceMock.list.mockClear();
    coursesServiceMock.list.mockClear();
    classesServiceMock.list.mockClear();
    enrollmentsServiceMock.list.mockClear();
    dialogServiceMock.open.mockClear();

    await TestBed.configureTestingModule({
      imports: [AttendancePage],
      providers: [
        { provide: AttendanceService, useValue: attendanceServiceMock },
        { provide: OrgSettingsService, useValue: orgSettingsServiceMock },
        { provide: DialogService, useValue: dialogServiceMock },
        { provide: OverlayContainerService, useValue: overlayContainerServiceMock },
        { provide: CampusesService, useValue: campusesServiceMock },
        { provide: CoursesService, useValue: coursesServiceMock },
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: EnrollmentsService, useValue: enrollmentsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AttendancePage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    localDialogService = fixture.debugElement.injector.get(DialogService);
    vi.spyOn(localDialogService, 'open').mockImplementation(dialogServiceMock.open);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to the first active campus and loads sessions without date range params', () => {
    const page = component as any;

    expect(page.selectedDateRange()).toEqual([]);
    expect(attendanceServiceMock.sessions).toHaveBeenLastCalledWith({
      dateFrom: undefined,
      dateTo: undefined,
      campusId: 'campus-1',
      courseIds: undefined,
      classIds: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it('loads active students with supported page size for advanced filters', () => {
    expect(studentsServiceMock.list).toHaveBeenCalledWith({
      isActive: true,
      page: 1,
      pageSize: 100,
    });
  });

  it('loads all student pages when total pages exceed one page', async () => {
    studentsServiceMock.list
      .mockReset()
      .mockReturnValueOnce(
        of({
          data: [
            {
              id: 'student-1',
              orgId: 'org-1',
              name: '劉小明',
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
              parentNames: ['劉爸爸'],
              campusNames: ['中正分校'],
              hasEnrollments: true,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          summary: { total: 2, activeCount: 2 },
          meta: { total: 2, page: 1, pageSize: 100, totalPages: 2 },
        }) as any,
      )
      .mockReturnValueOnce(
        of({
          data: [
            {
              id: 'student-2',
              orgId: 'org-1',
              name: '劉小華',
              grade: 'J2',
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
              parentNames: ['劉媽媽'],
              campusNames: ['中正分校'],
              hasEnrollments: true,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          summary: { total: 2, activeCount: 2 },
          meta: { total: 2, page: 2, pageSize: 100, totalPages: 2 },
        }) as any,
      );

    fixture = TestBed.createComponent(AttendancePage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    localDialogService = fixture.debugElement.injector.get(DialogService);
    vi.spyOn(localDialogService, 'open').mockImplementation(dialogServiceMock.open);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(studentsServiceMock.list).toHaveBeenNthCalledWith(1, {
      isActive: true,
      page: 1,
      pageSize: 100,
    });
    expect(studentsServiceMock.list).toHaveBeenNthCalledWith(2, {
      isActive: true,
      page: 2,
      pageSize: 100,
    });

    const page = component as any;
    expect(page.students().map((student: { id: string }) => student.id)).toEqual([
      'student-1',
      'student-2',
    ]);
  });

  it('formats event date as MM/DD with weekday', () => {
    const page = component as any;
    expect(page.formatEventDate('2026-04-01')).toBe('2026/04/01（週三）');
  });

  it('filters sessions by enrolled class ids when student filter is active', () => {
    const page = component as any;

    page.sessions.set([
      {
        eventId: 'event-1',
        classId: 'class-1',
        className: '數學 A',
        courseName: '數學',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '中正分校',
        eventDate: '2026-04-01',
        startTime: '09:00',
        endTime: '11:00',
        enrolledCount: 12,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
      {
        eventId: 'event-2',
        classId: 'class-2',
        className: '英文 B',
        courseName: '英文',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '中正分校',
        eventDate: '2026-04-01',
        startTime: '13:00',
        endTime: '15:00',
        enrolledCount: 10,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
    ]);

    page.selectedStudentIds.set(['student-1']);
    page.studentEnrolledClassIds.set(new Set(['class-2']));
    page.studentFilteredEnrollments.set([
      {
        classId: 'class-2',
        campusId: 'campus-1',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ]);

    expect(page.filteredSessions()).toEqual([
      expect.objectContaining({ eventId: 'event-2', classId: 'class-2' }),
    ]);
  });

  it('returns empty sessions when student filter is active but no matching enrollments exist', () => {
    const page = component as any;

    page.sessions.set([
      {
        eventId: 'event-1',
        classId: 'class-1',
        className: '數學 A',
        courseName: '數學',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '中正分校',
        eventDate: '2026-04-01',
        startTime: '09:00',
        endTime: '11:00',
        enrolledCount: 12,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
    ]);

    page.selectedStudentIds.set(['student-404']);
    page.studentEnrolledClassIds.set(new Set());
    page.studentFilteredEnrollments.set([]);

    expect(page.filteredSessions()).toEqual([]);
  });

  it('filters sessions by enrollment effective date range when student filter is active', () => {
    const page = component as any;

    page.sessions.set([
      {
        eventId: 'event-1',
        classId: 'class-1',
        className: '數學 A',
        courseName: '數學',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '中正分校',
        eventDate: '2026-04-01',
        startTime: '09:00',
        endTime: '11:00',
        enrolledCount: 12,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
      {
        eventId: 'event-2',
        classId: 'class-1',
        className: '數學 A',
        courseName: '數學',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '中正分校',
        eventDate: '2026-04-20',
        startTime: '09:00',
        endTime: '11:00',
        enrolledCount: 12,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
    ]);

    page.selectedStudentIds.set(['student-1']);
    page.studentEnrolledClassIds.set(new Set(['class-1']));
    page.studentFilteredEnrollments.set([
      {
        classId: 'class-1',
        campusId: 'campus-1',
        effectiveFrom: '2026-03-01',
        effectiveTo: '2026-04-10',
      },
    ]);

    expect(page.filteredSessions()).toEqual([
      expect.objectContaining({ eventId: 'event-1', classId: 'class-1' }),
    ]);
  });

  it('loads all enrollment pages for selected students and keeps withdrawal leave sessions visible', async () => {
    enrollmentsServiceMock.list.mockReset();
    enrollmentsServiceMock.list
      .mockReturnValueOnce(
        of({
          data: [
            {
              id: 'enrollment-1',
              orgId: 'org-1',
              classId: 'class-2',
              className: '英文 B',
              campusId: 'campus-1',
              campusName: '中正分校',
              courseId: 'course-2',
              courseName: '英文',
              studentId: 'student-1',
              studentName: '王小明',
              studentSchool: '測試國中',
              studentGrade: 'J1',
              status: 'active',
              billingMode: null,
              feeTemplateId: null,
              agreedAmount: null,
              adjustmentNote: null,
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
              notes: null,
              createdBy: null,
              createdByName: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              attendanceCount: 0,
            },
          ],
          meta: { total: 2, page: 1, pageSize: 100, totalPages: 2 },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: [
            {
              id: 'enrollment-2',
              orgId: 'org-1',
              classId: 'class-1',
              className: '數學 A',
              campusId: 'campus-1',
              campusName: '中正分校',
              courseId: 'course-1',
              courseName: '數學',
              studentId: 'student-1',
              studentName: '王小明',
              studentSchool: '測試國中',
              studentGrade: 'J1',
              status: 'withdrawal',
              billingMode: null,
              feeTemplateId: null,
              agreedAmount: null,
              adjustmentNote: null,
              effectiveFrom: '2026-03-01',
              effectiveTo: '2026-04-10',
              notes: null,
              createdBy: null,
              createdByName: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-04-11T00:00:00.000Z',
              attendanceCount: 1,
            },
          ],
          meta: { total: 2, page: 2, pageSize: 100, totalPages: 2 },
        }),
      );

    const page = component as any;
    page.sessions.set([
      {
        eventId: 'event-1',
        classId: 'class-1',
        className: '數學 A',
        courseName: '數學',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '中正分校',
        eventDate: '2026-04-08',
        startTime: '09:00',
        endTime: '11:00',
        enrolledCount: 12,
        presentCount: 8,
        onLeaveCount: 1,
        absentCount: 0,
        takenAt: '2026-04-08T11:00:00.000Z',
      },
    ]);

    await new Promise<void>((resolve) =>
      page.refreshStudentEnrolledClassIds(['student-1'], () => resolve()),
    );

    page.selectedStudentIds.set(['student-1']);

    expect(enrollmentsServiceMock.list).toHaveBeenNthCalledWith(1, {
      studentId: 'student-1',
      page: 1,
      pageSize: 100,
    });
    expect(enrollmentsServiceMock.list).toHaveBeenNthCalledWith(2, {
      studentId: 'student-1',
      page: 2,
      pageSize: 100,
    });
    expect(page.filteredSessions()).toEqual([
      expect.objectContaining({ eventId: 'event-1', classId: 'class-1', onLeaveCount: 1 }),
    ]);
  });

  it('loads sessions with date range, campus, paging, and class ids without redundant course ids', () => {
    const page = component as any;

    page.selectedDateRange.set([new Date('2026-04-01'), new Date('2026-04-03')]);
    page.selectedCampusId.set('campus-2');
    page.selectedCourseIds.set(['course-1']);
    page.selectedClassIds.set(['class-2']);
    page.currentPage.set(3);
    page.pageSize.set(50);

    page.loadSessions();

    expect(attendanceServiceMock.sessions).toHaveBeenLastCalledWith({
      dateFrom: '2026-04-01',
      dateTo: '2026-04-03',
      campusId: 'campus-2',
      courseIds: undefined,
      classIds: ['class-2'],
      page: 3,
      pageSize: 50,
    });
  });

  it('loads sessions without date params when no date range is selected', () => {
    const page = component as any;

    page.selectedDateRange.set([]);
    page.selectedCampusId.set('campus-2');
    page.currentPage.set(2);
    page.pageSize.set(50);

    page.loadSessions();

    expect(attendanceServiceMock.sessions).toHaveBeenLastCalledWith({
      dateFrom: undefined,
      dateTo: undefined,
      campusId: 'campus-2',
      courseIds: undefined,
      classIds: undefined,
      page: 2,
      pageSize: 50,
    });
  });

  it('opens shared advanced filters dialog and reapplies filters after dialog close', async () => {
    dialogServiceMock.open.mockReturnValue({
      onClose: of({
        courseIds: ['course-1'],
        classIds: ['class-2'],
        studentIds: ['student-1'],
        teacherIds: [],
        statuses: [],
      }),
    });
    enrollmentsServiceMock.list.mockReturnValueOnce(
      of({
        data: [{ classId: 'class-2' }],
        meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
      }),
    );

    const page = component as any;
    page.openAdvancedFiltersDialog();
    await fixture.whenStable();

    expect(localDialogService.open).toHaveBeenCalledWith(
      SessionAdvancedFiltersDialogComponent,
      expect.objectContaining({
        header: '進階篩選',
        closable: true,
        data: expect.objectContaining({
          mode: 'attendance',
          selectedCampusId: 'campus-1',
        }),
      }),
    );
    expect(enrollmentsServiceMock.list).toHaveBeenCalledWith({
      studentId: 'student-1',
      page: 1,
      pageSize: 100,
    });
    expect(attendanceServiceMock.sessions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        campusId: 'campus-1',
        courseIds: undefined,
        classIds: ['class-2'],
        page: 1,
        pageSize: 20,
      }),
    );
  });

  it('does not open roster panel for future sessions', () => {
    dialogServiceMock.open.mockClear();
    const page = component as any;

    page.openPanel({
      eventId: 'event-future',
      classId: 'class-1',
      className: '數學 A',
      courseName: '數學',
      teacherName: null,
      campusId: 'campus-1',
      campusName: '中正分校',
      eventDate: '2099-01-01',
      startTime: '09:00',
      endTime: '11:00',
      enrolledCount: 12,
      presentCount: 0,
      onLeaveCount: 0,
      absentCount: 0,
      takenAt: null,
    });

    expect(localDialogService.open).not.toHaveBeenCalled();
  });

  it('renders future sessions as locked instead of showing attendance action', () => {
    const page = component as any;

    page.sessions.set([
      {
        eventId: 'event-future',
        classId: 'class-1',
        className: '未來數學班',
        courseName: '數學',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '示範分校',
        eventDate: '2099-01-01',
        startTime: '14:00',
        endTime: '16:00',
        enrolledCount: 8,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
    ]);

    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    const buttonLabels = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((element) => (element.textContent ?? '').trim());
    expect(text).toContain('尚未開放點名');
    expect(buttonLabels).not.toContain('點名');
    expect(buttonLabels).not.toContain('修改點名');
  });

  it('renders lightweight toolbar without direct class or student multiselects', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('篩選');
    expect(text).not.toContain('篩選班級');
    expect(text).not.toContain('篩選學生');
  });

  it('renders a meta-row date node for wide-card container query layout', () => {
    const page = component as any;

    page.sessions.set([
      {
        eventId: 'event-1',
        classId: 'class-1',
        className: '英文班',
        courseName: '英文',
        teacherName: null,
        campusId: 'campus-1',
        campusName: '示範分校',
        eventDate: '2026-04-02',
        startTime: '14:00',
        endTime: '16:00',
        enrolledCount: 8,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
    ]);

    fixture.detectChanges();

    const metaDate = fixture.nativeElement.querySelector('.attendance-page__card-date--meta');
    expect(metaDate?.textContent?.trim()).toBe('2026/04/02（週四）');
  });

  it('opens audit log dialog for attendance records', () => {
    const page = component as any;

    page.openAuditLog();

    expect(localDialogService.open).toHaveBeenCalledWith(AuditLogDialogComponent, {
      header: '出勤紀錄操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        resourceTypes: ['attendance'],
      },
    });
  });
});
