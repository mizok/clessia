import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { format } from 'date-fns';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService, type Course } from '@core/courses.service';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { StudentsService, type Student } from '@core/students.service';
import {
  AttendanceRosterPanelComponent,
  type RosterPanelSession,
} from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import {
  SessionAdvancedFiltersDialogComponent,
  type SessionAdvancedFilterClassOption,
  type SessionAdvancedFiltersDialogResult,
} from '@shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    DynamicDialogModule,
    ToastModule,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly campusesService = inject(CampusesService);
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);

  protected readonly selectedDateRange = signal<Date[]>([]);
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly courses = signal<Course[]>([]);
  protected readonly classes = signal<SessionAdvancedFilterClassOption[]>([]);
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedCourseIds = signal<string[]>([]);
  protected readonly selectedClassIds = signal<string[]>([]);
  protected readonly students = signal<Student[]>([]);
  protected readonly selectedStudentIds = signal<string[]>([]);
  protected readonly studentEnrolledClassIds = signal<Set<string>>(new Set());
  protected readonly studentFilteredEnrollments = signal<Enrollment[]>([]);
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly totalSessions = signal(0);
  protected readonly loading = signal(false);
  protected readonly campusOptions = computed(() => this.campuses());
  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseIds().length > 0) count++;
    if (this.selectedClassIds().length > 0) count++;
    if (this.selectedStudentIds().length > 0) count++;
    return count;
  });
  protected readonly hasActiveFilters = computed(() => this.activeFilterCount() > 0);
  protected readonly filteredSessions = computed(() => {
    if (this.selectedStudentIds().length === 0) {
      return this.sessions();
    }

    const enrollments = this.studentFilteredEnrollments();
    const classIds = this.studentEnrolledClassIds();
    if (classIds.size === 0 || enrollments.length === 0) {
      return [];
    }

    return this.sessions().filter(
      (session) =>
        classIds.has(session.classId) && this.hasMatchingStudentEnrollment(session, enrollments),
    );
  });
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => this.orgSettingsService.settings.set(s),
    });
    this.campusesService.list({ isActive: true, pageSize: 100 }).subscribe({
      next: (res) => {
        this.campuses.set(res.data);

        if (!this.selectedCampusId() && res.data.length > 0) {
          this.selectedCampusId.set(res.data[0]?.id ?? null);
        }

        this.loadSessions();
      },
    });
    this.loadStudents();
    this.coursesService.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) => this.courses.set(res.data),
    });
    this.classesService.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) =>
        this.classes.set(
          res.data.map((classItem) => ({
            id: classItem.id,
            name: classItem.name,
            courseId: classItem.courseId,
            campusId: classItem.campusId,
          })),
        ),
    });
  }

  protected onDateRangeChange(range: Date[] | null): void {
    this.selectedDateRange.set(range ?? []);
    if ((range?.length ?? 0) >= 1 && range?.[0]) {
      this.currentPage.set(1);
      this.loadSessions();
    }
  }

  protected onCampusChange(campusId: string | null): void {
    this.selectedCampusId.set(campusId);
    this.clearAdvancedFiltersState();
    this.currentPage.set(1);
    this.loadSessions();
  }

  protected openAdvancedFiltersDialog(): void {
    const campusId = this.selectedCampusId();
    if (!campusId) {
      return;
    }

    const ref = this.dialogService.open(SessionAdvancedFiltersDialogComponent, {
      header: '進階篩選',
      width: '36rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      appendTo: this.overlayContainer ?? 'body',
      data: {
        mode: 'attendance',
        campuses: this.campuses(),
        courses: this.courses(),
        classes: this.classes(),
        students: this.students(),
        selectedCampusId: campusId,
        selectedCourseIds: this.selectedCourseIds(),
        selectedClassIds: this.selectedClassIds(),
        selectedStudentIds: this.selectedStudentIds(),
      },
    });

    ref?.onClose.subscribe((result?: SessionAdvancedFiltersDialogResult) => {
      if (!result) {
        return;
      }

      this.currentPage.set(1);
      this.selectedCourseIds.set(result.courseIds);
      this.selectedClassIds.set(result.classIds);
      this.selectedStudentIds.set(result.studentIds);
      this.refreshStudentEnrolledClassIds(result.studentIds, () => this.loadSessions());
    });
  }

  protected clearFilters(): void {
    this.currentPage.set(1);
    this.clearAdvancedFiltersState();
    this.loadSessions();
  }

  protected loadSessions(): void {
    const [start, end] = this.selectedDateRange();
    const campusId = this.selectedCampusId();
    const selectedClassIds = this.selectedClassIds();
    const selectedCourseIds = this.selectedCourseIds();

    if (!campusId) {
      this.sessions.set([]);
      this.totalSessions.set(0);
      return;
    }

    this.loading.set(true);
    this.attendanceService
      .sessions({
        dateFrom: start ? format(start, 'yyyy-MM-dd') : undefined,
        dateTo: end ? format(end, 'yyyy-MM-dd') : start ? format(start, 'yyyy-MM-dd') : undefined,
        campusId,
        courseIds:
          selectedClassIds.length === 0 && selectedCourseIds.length > 0
            ? selectedCourseIds
            : undefined,
        classIds: selectedClassIds.length > 0 ? selectedClassIds : undefined,
        page: this.currentPage(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (response) => {
          this.sessions.set(response.data);
          this.totalSessions.set(response.meta.total);
          this.currentPage.set(response.meta.page);
          this.pageSize.set(response.meta.pageSize);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      header: '出勤紀錄操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer ?? 'body',
      data: {
        resourceTypes: ['attendance'],
      },
    });
  }

  protected openPanel(session: EventSessionSummary): void {
    // 停課的課堂沒有出勤事件（後端刻意不補建）—— 沒有 eventId 就沒有名可點
    if (this.isFuture(session) || session.eventId === null) {
      return;
    }

    const data: RosterPanelSession = {
      eventId: session.eventId,
      className: session.className,
      eventDate: session.eventDate,
    };

    const ref = this.dialogService.open(AttendanceRosterPanelComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      appendTo: this.overlayContainer ?? 'body',
      data,
    });

    ref?.onClose.subscribe(
      (result?: {
        eventId: string;
        takenAt: string;
        presentCount: number;
        absentCount: number;
        onLeaveCount: number;
      }) => {
        if (result) this.onPanelSaved(result);
      },
    );
  }

  protected onPanelSaved(result: {
    eventId: string;
    takenAt: string;
    presentCount: number;
    absentCount: number;
    onLeaveCount: number;
  }): void {
    this.sessions.update((list) =>
      list.map((s) =>
        s.eventId === result.eventId
          ? {
              ...s,
              takenAt: result.takenAt,
              presentCount: result.presentCount,
              absentCount: result.absentCount,
              onLeaveCount: result.onLeaveCount,
            }
          : s,
      ),
    );
  }

  protected isTaken(session: EventSessionSummary): boolean {
    return session.takenAt !== null;
  }

  protected isFuture(session: EventSessionSummary): boolean {
    return session.eventDate > format(new Date(), 'yyyy-MM-dd');
  }

  protected isAdminLed(): boolean {
    return (this.orgSettingsService.settings()?.attendanceResponsible ?? 'admin') === 'admin';
  }

  protected formatEventDate(dateStr: string): string {
    const date = new Date(dateStr);
    const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}（週${weekdayLabels[date.getDay()] ?? ''}）`;
  }

  private clearAdvancedFiltersState(): void {
    this.selectedCourseIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.studentEnrolledClassIds.set(new Set());
    this.studentFilteredEnrollments.set([]);
  }

  private refreshStudentEnrolledClassIds(studentIds: string[], onComplete?: () => void): void {
    if (studentIds.length === 0) {
      this.studentEnrolledClassIds.set(new Set());
      this.studentFilteredEnrollments.set([]);
      onComplete?.();
      return;
    }

    forkJoin(studentIds.map((studentId) => this.loadAllStudentEnrollments(studentId))).subscribe({
      next: (results) => {
        const enrollments = results
          .flat()
          .filter((item) => isAttendanceStudentEnrollmentStatus(item.status));
        const classIds = new Set(
          enrollments
            .filter((item) => !item.campusId || item.campusId === this.selectedCampusId())
            .map((item) => item.classId),
        );
        this.studentFilteredEnrollments.set(enrollments);
        this.studentEnrolledClassIds.set(classIds);
        onComplete?.();
      },
      error: () => {
        this.studentFilteredEnrollments.set([]);
        this.studentEnrolledClassIds.set(new Set());
        onComplete?.();
      },
    });
  }

  private loadAllStudentEnrollments(studentId: string) {
    return this.enrollmentsService.list({ studentId, page: 1, pageSize: 100 }).pipe(
      switchMap((firstPage) => {
        const totalPages = firstPage.meta.totalPages ?? 1;
        if (totalPages <= 1) {
          return of(firstPage.data);
        }

        return forkJoin(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            this.enrollmentsService.list({
              studentId,
              page: index + 2,
              pageSize: 100,
            }),
          ),
        ).pipe(
          map((otherPages) => [firstPage.data, ...otherPages.map((page) => page.data)].flat()),
          catchError(() => of(firstPage.data)),
        );
      }),
    );
  }

  private loadStudents(): void {
    this.studentsService.list({ isActive: true, page: 1, pageSize: 100 }).subscribe({
      next: (firstPage) => {
        const totalPages = firstPage.meta.totalPages ?? 1;
        if (totalPages <= 1) {
          this.students.set(firstPage.data);
          return;
        }

        forkJoin(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            this.studentsService.list({
              isActive: true,
              page: index + 2,
              pageSize: 100,
            }),
          ),
        ).subscribe({
          next: (otherPages) => {
            this.students.set([firstPage.data, ...otherPages.map((page) => page.data)].flat());
          },
          error: () => {
            this.students.set(firstPage.data);
          },
        });
      },
      error: () => {
        this.students.set([]);
      },
    });
  }

  private hasMatchingStudentEnrollment(
    session: EventSessionSummary,
    enrollments: ReadonlyArray<Enrollment>,
  ): boolean {
    return enrollments.some((enrollment) => {
      if (enrollment.classId !== session.classId) {
        return false;
      }

      if (enrollment.campusId && session.campusId && enrollment.campusId !== session.campusId) {
        return false;
      }

      return isDateWithinRange(session.eventDate, enrollment.effectiveFrom, enrollment.effectiveTo);
    });
  }
}

function isDateWithinRange(date: string, start: string, end: string | null): boolean {
  return date >= start && (end === null || date <= end);
}

function isAttendanceStudentEnrollmentStatus(status: Enrollment['status']): boolean {
  return status === 'active' || status === 'suspended' || status === 'withdrawal';
}
