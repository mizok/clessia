import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { toObservable } from '@angular/core/rxjs-interop';
import { catchError, filter, forkJoin, map, of, switchMap, take } from 'rxjs';
import { MessageService, type MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { DialogService } from 'primeng/dynamicdialog';

import type { Campus } from '@core/campuses.service';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService, type Course } from '@core/courses.service';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { SessionsService, type Session } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { StudentsService, type Student } from '@core/students.service';
import {
  SessionAdvancedFiltersDialogComponent,
  type SessionAdvancedFiltersDialogResult,
} from '@shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component';

import { SessionCancelDialogComponent } from './dialogs/session-cancel-dialog/session-cancel-dialog.component';
import { parseAttendanceQueryParams } from './sessions.util';
import { AttendanceRosterPanelComponent } from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
import { SessionOperationsLogDialogComponent } from './dialogs/session-operations-log-dialog/session-operations-log-dialog.component';
import { SessionRescheduleDialogComponent } from './dialogs/session-reschedule-dialog/session-reschedule-dialog.component';
import { SessionAssignDialogComponent } from './dialogs/session-assign-dialog/session-assign-dialog.component';
import { SessionSubstituteDialogComponent } from './dialogs/session-substitute-dialog/session-substitute-dialog.component';
import {
  MobileFilterDialogComponent,
  type MobileFilterDialogData,
  type MobileFilterDialogResult,
} from './dialogs/mobile-filter-dialog/mobile-filter-dialog.component';
import {
  MobileBatchDialogComponent,
  type MobileBatchDialogData,
  type MobileBatchDialogResult,
} from './dialogs/mobile-batch-dialog/mobile-batch-dialog.component';
import {
  SessionFiltersComponent,
  DEFAULT_STATUSES,
} from './components/session-filters/session-filters.component';
import { SessionsHeaderComponent } from './components/sessions-header/sessions-header.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import {
  SessionsBodyComponent,
  type SessionsBodyBatchMode,
  type SessionsBodyContextMenuEvent,
} from './components/sessions-body/sessions-body.component';
import { SessionsActionsService } from './services/sessions-actions.service';
import { todayLocal } from '@shared/utils/session-time.util';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

/**
 * 列表用的課堂 —— 比 `Session` 多一個 `eventId`。
 *
 * 三態，**不要壓成兩態**：
 * - `string` —— 出勤事件在，點得了名
 * - `null` —— 停課，後端刻意不補建事件（`EventSessionSummary.eventId` 的註解），點不了
 * - `undefined` —— **還不知道**（出勤摘要那支 API 掛了，`loadAttendanceSummaries` 吞掉錯誤回空陣列）
 *
 * 把 `undefined` 當成 `null` 會讓摘要 API 一掛掉、整頁的點名入口就全部灰掉 ——
 * 那是把「沒問到」講成「不能點」（`kb/wiki/lessons/empty-array-hides-loading.md`）。
 */
type SessionRow = Session & { readonly eventId?: string | null };

interface AttendanceDialogCloseResult {
  readonly eventId: string;
  readonly takenAt: string;
  readonly presentCount: number;
  readonly absentCount: number;
  readonly onLeaveCount: number;
}

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [
    ToastModule,
    PopupMenuComponent,
    ButtonModule,
    SessionsHeaderComponent,
    SessionsBodyComponent,
    SessionFiltersComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './sessions.page.html',
  styleUrl: './sessions.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly refData = inject(ReferenceDataService);
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly sessionsService = inject(SessionsService);
  private readonly sessionsActionsService = inject(SessionsActionsService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly dialogService = inject(DialogService);
  private readonly studentsService = inject(StudentsService);
  private readonly route = inject(ActivatedRoute);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // ── View state ─────────────────────────────────────────────────────────
  protected readonly loading = signal(false);
  protected readonly sessions = signal<SessionRow[]>([]);

  // Filter options — campuses & teachers come from shared cache
  protected readonly campuses = computed(() => this.refData.campuses());
  private readonly firstCampus$ = toObservable(this.campuses).pipe(
    filter((campuses) => campuses.length > 0),
    take(1),
  );
  protected readonly courses = signal<Course[]>([]);
  protected readonly staff = computed(() => this.refData.teachers());
  protected readonly classes = signal<
    Array<{ id: string; name: string; courseId: string; campusId: string }>
  >([]);

  private readonly sessionMenuRef = viewChild<PopupMenuComponent>('sessionMenu');

  // ── Filter state ───────────────────────────────────────────────────────
  protected readonly selectedCampusIds = signal<string[]>([]);
  protected readonly selectedCampusId = computed(() => this.selectedCampusIds()[0] ?? null);
  protected readonly selectedCampusName = computed(() => {
    const id = this.selectedCampusId();
    if (!id) return null;
    return this.campuses().find((c) => c.id === id)?.name ?? null;
  });
  protected readonly selectedCourseIds = signal<string[]>([]);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedClassIds = signal<string[]>([]);
  protected readonly selectedStudentIds = signal<string[]>([]);
  protected readonly selectedStatuses = signal<string[]>([...DEFAULT_STATUSES]);
  protected readonly currentPage = signal(1);
  protected readonly totalSessions = signal(0);
  protected readonly PAGE_SIZE = LIST_PAGE_SIZE;
  protected readonly students = signal<Student[]>([]);
  protected readonly studentEnrolledClassIds = signal<Set<string>>(new Set());
  protected readonly studentFilteredEnrollments = signal<Enrollment[]>([]);

  // ── List date range ────────────────────────────────────────────────────
  protected readonly listDateRange = signal<Date[]>([
    startOfMonth(new Date()),
    endOfMonth(new Date()),
  ]);
  protected readonly listDateRangeModified = signal(false);

  /**
   * 有沒有點名過——從別頁（目前是儀表板的未點名卡）連過來時帶的篩選。
   * `undefined` 是「沒有這個篩選」，不是「false」。
   */
  protected readonly attendanceTakenFilter = signal<boolean | undefined>(undefined);

  /**
   * 只篩「已經上完」的課堂——配 `attendanceTakenFilter() === false` 一次表達
   * 「沒點名而且已經上完」，落地頁看到的堂數才對得上儀表板卡片的數字（不含
   * 今天還在進行中、還沒到點名時間的課）。沒有「undefined vs false」的區分
   * ——API 這個參數只吃 `true` 或不帶，false 就是不篩，跟預設狀態相同。
   */
  protected readonly endedOnlyFilter = signal(false);

  // ── Computed ───────────────────────────────────────────────────────────
  protected readonly activeTeachers = computed(() =>
    this.staff().filter((s) => s.roles.includes('teacher')),
  );

  protected readonly availableCourses = computed(() => {
    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) return this.courses();
    return this.courses().filter((c) => campusIds.includes(c.campusId));
  });

  protected readonly availableTeachers = computed(() => {
    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) return this.activeTeachers();

    let filtered = this.activeTeachers().filter((t) =>
      t.campusIds.some((cid) => campusIds.includes(cid)),
    );

    const courseIds = this.selectedCourseIds();
    if (courseIds.length > 0) {
      const selectedCourses = this.courses().filter((c) => courseIds.includes(c.id));
      const subjectIds = new Set(selectedCourses.map((c) => c.subjectId));
      filtered = filtered.filter((t) => t.subjectIds.some((sid) => subjectIds.has(sid)));
    }
    return filtered;
  });

  protected readonly availableClasses = computed(() => {
    const courseIds = this.selectedCourseIds();
    const campusIds = this.selectedCampusIds();
    if (courseIds.length === 0) return [];
    return this.classes().filter(
      (c) =>
        courseIds.includes(c.courseId) &&
        (campusIds.length === 0 || campusIds.includes(c.campusId)),
    );
  });

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseIds().length > 0) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.selectedClassIds().length > 0) count++;
    if (this.selectedStudentIds().length > 0) count++;
    if (!this.isDefaultStatuses()) count++;
    return count;
  });

  protected readonly hasActiveFilters = computed(
    () =>
      this.selectedCourseIds().length > 0 ||
      this.selectedTeacherIds().length > 0 ||
      this.selectedClassIds().length > 0 ||
      this.selectedStudentIds().length > 0 ||
      !this.isDefaultStatuses(),
  );

  protected readonly monthUnassignedCount = signal(0);
  protected readonly todayPendingAttendanceCount = signal(0);
  protected readonly displayedSessions = computed(() => {
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
  protected readonly displayedTotal = computed(() =>
    this.selectedStudentIds().length > 0 ? this.displayedSessions().length : this.totalSessions(),
  );

  // ── Selection state ────────────────────────────────────────────────────
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly selectedSessions = computed(() => {
    const selected = this.selectedIds();
    if (selected.size === 0) return [];
    return this.displayedSessions().filter((session) => selected.has(session.id));
  });
  protected readonly hasCancelledSelection = computed(() =>
    this.selectedSessions().some((session) => session.status === 'cancelled'),
  );
  protected readonly batchAssignableTeachers = computed(() => {
    const sessions = this.selectedSessions();
    if (sessions.length === 0) return [];
    const courseSubjectMap = new Map(this.courses().map((course) => [course.id, course.subjectId]));
    return this.activeTeachers().filter((teacher) =>
      sessions.every((session) => {
        const subjectId = courseSubjectMap.get(session.courseId);
        if (!subjectId) return false;
        return (
          teacher.campusIds.includes(session.campusId) && teacher.subjectIds.includes(subjectId)
        );
      }),
    );
  });

  // ── Context menu ───────────────────────────────────────────────────────
  protected readonly contextSession = signal<SessionRow | null>(null);
  protected readonly contextMenuItems = computed<MenuItem[]>(() => {
    const s = this.contextSession();
    if (!s) return [];
    const items: MenuItem[] = [
      { label: '查看異動紀錄', icon: 'pi pi-eye', command: () => this.openDetail(s) },
      {
        label: '管理出勤狀況',
        icon: 'pi pi-id-card',
        // UTC 日期會讓半夜的「今天」被當成未來，選項會被錯誤 disable
        // `eventId === null` 是停課（沒有出勤事件可點）；`undefined` 是還不知道，不擋
        disabled: s.sessionDate > todayLocal() || s.eventId === null,
        command: () => this.openAttendance(s),
      },
    ];
    if (s.status === 'scheduled') {
      items.push({ label: '調課', icon: 'pi pi-arrows-h', command: () => this.openReschedule(s) });
    }
    if (s.status === 'scheduled' && s.assignmentStatus === 'assigned') {
      items.push({ label: '代課', icon: 'pi pi-user-edit', command: () => this.openSubstitute(s) });
    }
    if (s.assignmentStatus === 'unassigned' && s.status === 'scheduled') {
      items.push({
        label: '指派老師',
        icon: 'pi pi-user-plus',
        command: () => this.openAssignSingle(s),
      });
    }
    if (s.status === 'scheduled') {
      items.push({ label: '停課', icon: 'pi pi-ban', command: () => this.openCancelDialog(s) });
    }
    if (s.status === 'cancelled') {
      items.push({
        label: '取消停課',
        icon: 'pi pi-replay',
        command: () => this.uncancelSingle(s),
      });
    }
    return items;
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.applyIncomingAttendanceFilter();
    this.loadFilters();
    this.loadStudents();
    this.firstCampus$.subscribe((campuses) => {
      this.selectedCampusIds.set([campuses[0].id]);
      this.loadSessions();
    });
  }

  // ── List actions ───────────────────────────────────────────────────────
  protected onSelectedIdsChange(ids: string[]): void {
    this.selectedIds.set(new Set(ids));
  }

  protected onSessionListContextMenu(request: SessionsBodyContextMenuEvent): void {
    this.contextSession.set(request.session);
    this.sessionMenuRef()?.toggle(request.event);
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected openOperationsLog(): void {
    this.dialogService.open(SessionOperationsLogDialogComponent, {
      header: '操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });
  }

  // ── Batch dialog ───────────────────────────────────────────────────────
  protected openBatchSheet(initialMode: SessionsBodyBatchMode | null = null): void {
    const data: MobileBatchDialogData = {
      sessionIds: [...this.selectedIds()],
      selectedCount: this.selectedCount(),
      teachers: this.batchAssignableTeachers(),
      hasCancelledSelection: this.hasCancelledSelection(),
      initialMode,
    };
    const ref = this.dialogService.open(MobileBatchDialogComponent, {
      header: `已選 ${this.selectedCount()} 堂`,
      width: '420px',
      closable: true,
      closeOnEscape: true,
      dismissableMask: true,
      appendTo: this.overlayContainer ?? 'body',
      data,
    });
    ref?.onClose.subscribe((result?: MobileBatchDialogResult) => {
      if (result?.action === 'applied') {
        this.clearSelection();
        this.loadSessions();
        const modeLabel: Record<string, string> = {
          cancel: '停課',
          uncancel: '取消停課',
          assign: '指派老師',
          time: '調整時間',
        };
        const label = modeLabel[result.mode] ?? '更新';
        const skipReasonMap: Record<string, string> = {
          cancel: '已停課的課堂無法重複操作',
          uncancel: '僅停課中的課堂可取消停課',
          assign: '已指派老師的課堂已略過',
          time: '已停課的課堂無法調整時間',
        };
        const skipReason = skipReasonMap[result.mode] ?? '條件不符';
        const detail =
          result.skipped > 0
            ? `已${label} ${result.updated} 堂，略過 ${result.skipped} 堂（${skipReason}）`
            : `已${label} ${result.updated} 堂`;
        this.messageService.add({ severity: 'success', summary: '批次操作完成', detail });
      }
    });
  }

  protected openAdvancedFiltersDialog(): void {
    if (this.isMobileViewport()) {
      this.openMobileFiltersDialog();
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
        mode: 'sessions',
        campuses: this.campuses(),
        courses: this.courses(),
        classes: this.classes(),
        students: this.students(),
        teachers: this.activeTeachers(),
        selectedCampusIds: this.selectedCampusIds(),
        selectedCourseIds: this.selectedCourseIds(),
        selectedClassIds: this.selectedClassIds(),
        selectedStudentIds: this.selectedStudentIds(),
        selectedTeacherIds: this.selectedTeacherIds(),
        selectedStatuses: this.selectedStatuses(),
      },
    });

    ref?.onClose.subscribe((result?: SessionAdvancedFiltersDialogResult) => {
      if (!result) {
        return;
      }

      this.currentPage.set(1);
      this.selectedCourseIds.set(result.courseIds);
      this.selectedTeacherIds.set(result.teacherIds);
      this.selectedClassIds.set(result.classIds);
      this.selectedStatuses.set(result.statuses);
      this.selectedStudentIds.set(result.studentIds);
      this.refreshStudentEnrolledClassIds(result.studentIds, () => this.loadSessions());
    });
  }

  private openMobileFiltersDialog(): void {
    const data: MobileFilterDialogData = {
      campuses: this.campuses(),
      courses: this.courses(),
      teachers: this.activeTeachers(),
      students: this.students(),
      sessions: this.sessions(),
      classes: this.classes(),
      selectedCampusIds: this.selectedCampusIds(),
      selectedCourseIds: this.selectedCourseIds(),
      selectedTeacherIds: this.selectedTeacherIds(),
      selectedClassIds: this.selectedClassIds(),
      selectedStudentIds: this.selectedStudentIds(),
      selectedStatuses: this.selectedStatuses(),
    };
    const ref = this.dialogService.open(MobileFilterDialogComponent, {
      header: '篩選條件',
      width: '420px',
      closable: true,
      closeOnEscape: true,
      dismissableMask: true,
      appendTo: this.overlayContainer ?? 'body',
      data,
    });
    ref?.onClose.subscribe((result?: MobileFilterDialogResult) => {
      if (result) {
        this.currentPage.set(1);
        this.selectedCampusIds.set(result.campusIds);
        this.selectedCourseIds.set(result.courseIds);
        this.selectedTeacherIds.set(result.teacherIds);
        this.selectedClassIds.set(result.classIds);
        this.selectedStudentIds.set(result.studentIds);
        this.selectedStatuses.set(result.statuses);
        this.refreshStudentEnrolledClassIds(result.studentIds, () => this.loadSessions());
      }
    });
  }

  // ── Single-session actions ─────────────────────────────────────────────
  protected openReschedule(session: Session): void {
    const ref = this.dialogService.open(SessionRescheduleDialogComponent, {
      header: '調課',
      width: '400px',
      data: { session },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  protected openSubstitute(session: Session): void {
    const ref = this.dialogService.open(SessionSubstituteDialogComponent, {
      header: '安排代課',
      width: '400px',
      data: { session },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  protected openCancelDialog(session: Session): void {
    const ref = this.dialogService.open(SessionCancelDialogComponent, {
      header: '停課',
      width: '400px',
      data: { session },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result?: { result: string } | string) => {
      const didRefresh =
        typeof result === 'string' ? result === 'refresh' : result?.result === 'refresh';
      if (didRefresh) {
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '已停課',
          detail: '如需安排補課，請新增調課',
          life: 6000,
        });
      }
    });
  }

  protected uncancelSingle(session: Session): void {
    this.sessionsActionsService.uncancelSingle(session.id).subscribe({
      next: () => {
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '已取消停課',
          detail: `${session.className} ${session.sessionDate}`,
        });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '操作失敗', detail: '無法取消停課' });
      },
    });
  }

  protected openAssignSingle(session: Session): void {
    const eligibleTeachers = this.getEligibleTeachersForSession(session);
    const ref = this.dialogService.open(SessionAssignDialogComponent, {
      header: '指派老師',
      width: '400px',
      data: { session, ...(eligibleTeachers.length > 0 ? { teachers: eligibleTeachers } : {}) },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  // ── Filters ────────────────────────────────────────────────────────────
  protected onCampusIdChange(id: string | null): void {
    this.currentPage.set(1);
    this.selectedCampusIds.set(id ? [id] : []);
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.refreshStudentEnrolledClassIds(this.selectedStudentIds(), () => this.loadSessions());
  }

  protected onCourseIdsChange(ids: string[]): void {
    this.currentPage.set(1);
    this.selectedCourseIds.set(ids);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.loadSessions();
  }

  protected onTeacherIdsChange(ids: string[]): void {
    this.currentPage.set(1);
    this.selectedTeacherIds.set(ids);
    this.loadSessions();
  }

  protected onClassChange(classIds: string[]): void {
    this.currentPage.set(1);
    this.selectedClassIds.set(classIds);
    this.loadSessions();
  }

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRange.set(range);
    this.currentPage.set(1);
    this.listDateRangeModified.set(true);
    if (range.length >= 1 && range[0]) {
      this.loadSessions();
    }
  }

  protected onStatusesChange(statuses: string[] | null): void {
    this.currentPage.set(1);
    this.selectedStatuses.set(statuses ?? []);
    this.loadSessions();
  }

  protected onFilterUnassigned(): void {
    this.currentPage.set(1);
    const now = new Date();
    this.listDateRange.set([startOfMonth(now), endOfMonth(now)]);
    this.listDateRangeModified.set(false);
    this.selectedCourseIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.selectedStatuses.set(['scheduled']);
    this.selectedTeacherIds.set(['__unassigned__']);
    this.attendanceTakenFilter.set(undefined);
    this.endedOnlyFilter.set(false);
    this.loadSessions();
  }

  protected onFilterPendingAttendance(): void {
    this.currentPage.set(1);
    const today = new Date();
    this.listDateRange.set([today, today]);
    this.listDateRangeModified.set(true);
    this.selectedCourseIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedStatuses.set(['scheduled', 'completed']);
    // 現在真的篩得到了（#363）——badge 數字跟這裡套用的篩選同一個條件。
    this.attendanceTakenFilter.set(false);
    this.loadSessions();
  }

  /**
   * 從儀表板未點名卡連過來時套用的篩選（見 `sessions.util.ts` 的
   * `parseAttendanceQueryParams`）。查不到完整的三個欄位就什麼都不做——
   * 一般從選單點進這頁不會帶這些 query params，維持原本的預設篩選。
   */
  private applyIncomingAttendanceFilter(): void {
    const incoming = parseAttendanceQueryParams(this.route.snapshot.queryParams);
    if (!incoming) return;

    this.listDateRange.set([incoming.dateFrom, incoming.dateTo]);
    this.listDateRangeModified.set(true);
    this.attendanceTakenFilter.set(incoming.attendanceTaken);
    this.endedOnlyFilter.set(incoming.endedOnly);
    // 來源頁明著指定了課堂狀態就照它的，沒帶才留著本頁的 `DEFAULT_STATUSES`（#456）——
    // 兩份剛好相等的預設值會靜靜分歧，而「卡片 15、點進去 12」兩個數字都看起來合理
    if (incoming.statuses) this.selectedStatuses.set([...incoming.statuses]);
  }

  protected clearFilters(): void {
    this.currentPage.set(1);
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.studentEnrolledClassIds.set(new Set());
    this.studentFilteredEnrollments.set([]);
    this.selectedStatuses.set([...DEFAULT_STATUSES]);
    this.attendanceTakenFilter.set(undefined);
    this.endedOnlyFilter.set(false);
    this.loadSessions();
  }

  // ── Detail popup ───────────────────────────────────────────────────────
  protected openDetail(session: Session): void {
    this.dialogService.open(SessionDetailDialogComponent, {
      header: '異動紀錄',
      width: '400px',
      data: { session, loadingChanges: true, changes: [] },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
  }

  protected openAttendance(session: SessionRow): void {
    // `undefined` = 出勤摘要那支 API 沒回來。原本的對話框會自己反查一次，但反查打的是
    // **同一支 API**，所以那時候它也是壞的 —— 差別只在壞在對話框裡還是壞在入口。
    if (!session.eventId) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法開啟點名',
        detail: '出勤資料尚未載入完成，請重新整理後再試。',
      });
      return;
    }

    const ref = this.dialogService.open(AttendanceRosterPanelComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      data: {
        eventId: session.eventId,
        className: session.className,
        eventDate: session.sessionDate,
        timeRange: `${session.startTime}–${session.endTime}`,
      },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });

    ref?.onClose.subscribe((result?: AttendanceDialogCloseResult) => {
      if (!result) {
        return;
      }

      this.sessions.update((sessions) =>
        sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                attendanceTakenAt: result.takenAt,
                attendancePresentCount: result.presentCount,
                attendanceAbsentCount: result.absentCount,
                attendanceOnLeaveCount: result.onLeaveCount,
              }
            : item,
        ),
      );
    });
  }

  protected onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadSessions();
  }

  // ── Private ────────────────────────────────────────────────────────────
  private isDefaultStatuses(): boolean {
    const current = [...this.selectedStatuses()].sort().join(',');
    const def = [...DEFAULT_STATUSES].sort().join(',');
    return current === def;
  }

  private isMobileViewport(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    return window.innerWidth <= 768;
  }

  private getEligibleTeachersForSession(session: Session): Staff[] {
    const campusTeachers = this.activeTeachers().filter((t) =>
      t.campusIds.includes(session.campusId),
    );
    const course = this.courses().find((c) => c.id === session.courseId);
    if (!course) return campusTeachers;
    return campusTeachers.filter((t) => t.subjectIds.includes(course.subjectId));
  }

  private loadFilters(): void {
    this.refData.loadCampuses();
    this.refData.loadTeachers();
    this.coursesService.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) => this.courses.set(res.data),
    });
    this.classesService.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) =>
        this.classes.set(
          res.data.map((c) => ({
            id: c.id,
            name: c.name,
            courseId: c.courseId,
            campusId: c.campusId,
          })),
        ),
    });
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

  private loadSessions(): void {
    const range = this.listDateRange();
    const rawIds = this.selectedTeacherIds();
    const realTeacherIds = rawIds.filter((id) => id !== '__unassigned__');
    const hasUnassigned = rawIds.includes('__unassigned__');
    const dateFrom = range[0] ? format(range[0], 'yyyy-MM-dd') : undefined;
    const dateTo = range[1]
      ? format(range[1], 'yyyy-MM-dd')
      : range[0]
        ? format(range[0], 'yyyy-MM-dd')
        : undefined;

    // When student filter is active, restrict API query to that student's enrolled classes.
    // Without this, pagination means only a fraction of matching sessions would be visible.
    let effectiveClassIds: string[] | undefined;
    if (this.selectedStudentIds().length > 0) {
      const studentClassIds = [...this.studentEnrolledClassIds()];
      if (studentClassIds.length === 0) {
        // Student has no matching enrollments — nothing to show
        this.sessions.set([]);
        this.totalSessions.set(0);
        this.loading.set(false);
        return;
      }
      const explicitClassIds = this.selectedClassIds();
      if (explicitClassIds.length > 0) {
        const studentSet = new Set(studentClassIds);
        effectiveClassIds = explicitClassIds.filter((id) => studentSet.has(id));
        if (effectiveClassIds.length === 0) {
          this.sessions.set([]);
          this.totalSessions.set(0);
          this.loading.set(false);
          return;
        }
      } else {
        effectiveClassIds = studentClassIds;
      }
    } else {
      effectiveClassIds = this.selectedClassIds().length > 0 ? this.selectedClassIds() : undefined;
    }

    this.loading.set(true);
    this.sessionsService
      .list({
        from: dateFrom,
        to: dateTo,
        campusIds: this.selectedCampusIds().length > 0 ? this.selectedCampusIds() : undefined,
        courseIds: this.selectedCourseIds().length > 0 ? this.selectedCourseIds() : undefined,
        teacherIds: realTeacherIds.length > 0 ? realTeacherIds : undefined,
        classIds: effectiveClassIds,
        assignmentStatus: hasUnassigned ? 'unassigned' : undefined,
        attendanceTaken: this.attendanceTakenFilter(),
        endedOnly: this.endedOnlyFilter(),
        statuses: this.selectedStatuses().length > 0 ? this.selectedStatuses() : undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .pipe(
        switchMap((res) =>
          this.loadAttendanceSummaries(res.data, dateFrom, dateTo).pipe(
            map((summaries) => ({
              res,
              sessions: this.mergeAttendanceSummaries(res.data, summaries),
            })),
          ),
        ),
      )
      .subscribe({
        next: ({ res, sessions }) => {
          this.sessions.set(sessions);
          this.totalSessions.set(res.meta.total);
          this.monthUnassignedCount.set(res.meta.monthUnassignedCount);
          this.todayPendingAttendanceCount.set(res.meta.todayPendingAttendanceCount);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入課堂資料',
          });
        },
      });
  }

  private loadAttendanceSummaries(
    sessions: readonly Session[],
    dateFrom?: string,
    dateTo?: string,
  ) {
    if (sessions.length === 0) {
      return of([] as EventSessionSummary[]);
    }

    const classIds = [...new Set(sessions.map((session) => session.classId))];
    const dates = sessions.map((session) => session.sessionDate).sort();

    return this.attendanceService
      .sessions({
        classIds,
        dateFrom: dateFrom ?? dates[0],
        dateTo: dateTo ?? dates.at(-1),
        page: 1,
        pageSize: 100,
      })
      .pipe(
        map((response) => response.data),
        catchError(() => of([] as EventSessionSummary[])),
      );
  }

  private mergeAttendanceSummaries(
    sessions: readonly Session[],
    summaries: readonly EventSessionSummary[],
  ): SessionRow[] {
    const summaryMap = new Map(
      summaries.map((summary) => [this.getAttendanceSummaryKey(summary), summary]),
    );

    return sessions.map((session) => {
      const summary = summaryMap.get(this.getAttendanceSummaryKey(session));
      if (!summary) {
        return session;
      }

      return {
        ...session,
        // 這裡本來就配對到 summary 了，eventId 一起帶走 —— 不帶的話點開對話框時
        // 會用同一組 key 再打一次同一支 API 做一模一樣的配對
        eventId: summary.eventId,
        attendanceTakenAt: summary.takenAt,
        attendanceEnrolledCount: summary.enrolledCount,
        attendancePresentCount: summary.presentCount,
        attendanceOnLeaveCount: summary.onLeaveCount,
        attendanceAbsentCount: summary.absentCount,
      };
    });
  }

  private getAttendanceSummaryKey(
    value:
      | Pick<Session, 'classId' | 'sessionDate' | 'startTime' | 'endTime'>
      | Pick<EventSessionSummary, 'classId' | 'eventDate' | 'startTime' | 'endTime'>,
  ): string {
    const date = 'sessionDate' in value ? value.sessionDate : value.eventDate;
    return [value.classId, date, value.startTime ?? '', value.endTime ?? ''].join('|');
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
        const campusIds = this.selectedCampusIds();
        const classIds = new Set(
          enrollments
            .filter(
              (item) =>
                campusIds.length === 0 || !item.campusId || campusIds.includes(item.campusId),
            )
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

  private hasMatchingStudentEnrollment(
    session: Session,
    enrollments: ReadonlyArray<Enrollment>,
  ): boolean {
    return enrollments.some((enrollment) => {
      if (enrollment.classId !== session.classId) {
        return false;
      }

      if (enrollment.campusId && enrollment.campusId !== session.campusId) {
        return false;
      }

      return isDateWithinRange(
        session.sessionDate,
        enrollment.effectiveFrom,
        enrollment.effectiveTo,
      );
    });
  }
}

function isDateWithinRange(date: string, start: string, end: string | null): boolean {
  return date >= start && (end === null || date <= end);
}

function isAttendanceStudentEnrollmentStatus(status: Enrollment['status']): boolean {
  return status === 'active' || status === 'suspended' || status === 'withdrawal';
}
