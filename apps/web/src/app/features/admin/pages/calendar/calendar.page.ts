import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  addDays,
  addWeeks,
  endOfWeek,
  endOfMonth,
  format,
  isSameWeek,
  isToday,
  startOfWeek,
} from 'date-fns';
import { debounceTime, fromEvent } from 'rxjs';
import { zhTW } from 'date-fns/locale';
import { MessageService, type MenuItem } from 'primeng/api';
import { MenuModule, type Menu } from 'primeng/menu';
import { ToastModule } from 'primeng/toast';
import { DialogService } from 'primeng/dynamicdialog';

import { CampusesService, type Campus } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService, type Course } from '@core/courses.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  SessionsService,
  type Session,
} from '@core/sessions.service';
import { StaffService, type Staff } from '@core/staff.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SessionCancelDialogComponent } from './dialogs/session-cancel-dialog/session-cancel-dialog.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
import { SessionOverflowDialogComponent } from './dialogs/session-overflow-dialog/session-overflow-dialog.component';
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
import { SessionFiltersComponent } from './components/session-filters/session-filters.component';
import { CalendarHeaderComponent } from './components/calendar-header/calendar-header.component';
import {
  CalendarBodyComponent,
  type CalendarBodyBatchMode,
  type CalendarBodyContextMenuEvent,
  type CalendarBodyOverflowEvent,
} from './components/calendar-body/calendar-body.component';
import { CalendarActionsService } from './services/calendar-actions.service';

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    ToastModule,
    MenuModule,
    CalendarHeaderComponent,
    CalendarBodyComponent,
    SessionFiltersComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './calendar.page.html',
  styleUrl: './calendar.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly campusesService = inject(CampusesService);
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly staffService = inject(StaffService);
  private readonly sessionsService = inject(SessionsService);
  private readonly calendarActionsService = inject(CalendarActionsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseId()) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.selectedClassId()) count++;
    if (this.viewMode() === 'list' && this.listDateRangeModified()) count++;
    if (this.viewMode() === 'list' && this.showOnlyUnassigned()) count++;
    return count;
  });

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // ── View state (signals) ───────────────────────────────────────────────
  protected readonly currentDate = signal(new Date());
  protected readonly isWeekView = signal(window.innerWidth >= 768);
  protected readonly viewMode = signal<'calendar' | 'list'>('list');
  protected readonly loading = signal(false);
  protected readonly sessions = signal<Session[]>([]);

  // Filter options (signals)
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly courses = signal<Course[]>([]);
  protected readonly staff = signal<Staff[]>([]);
  protected readonly classes = signal<
    Array<{ id: string; name: string; courseId: string; campusId: string }>
  >([]);

  private readonly sessionMenuRef = viewChild<Menu>('sessionMenu');

  // ── Filter state ───────────────────────────────────────────────────────
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedCourseId = signal<string | null>(null);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedClassId = signal<string | null>(null);
  protected readonly showOnlyUnassigned = signal(false);

  // ── List view date range (independent from calendar week/day) ──────────
  protected readonly listDateRange = signal<Date[]>(this.getDefaultListDateRange());
  protected readonly listDateRangeModified = signal(false);

  // ── Computed ───────────────────────────────────────────────────────────
  protected readonly availableCourses = computed(() => {
    const campusId = this.selectedCampusId();
    if (!campusId) return [];
    return this.courses().filter((c) => c.campusId === campusId);
  });

  protected readonly availableTeachers = computed(() => {
    const campusId = this.selectedCampusId();
    if (!campusId) return [];

    let filteredTeachers = this.activeTeachers().filter((t) => t.campusIds.includes(campusId));
    const courseId = this.selectedCourseId();
    if (courseId) {
      const course = this.courses().find((c) => c.id === courseId);
      if (course) {
        filteredTeachers = filteredTeachers.filter((t) => t.subjectIds.includes(course.subjectId));
      }

      // For selected course, only keep teachers that are actually assigned to
      // currently loaded sessions under the same campus/course filters.
      const assignedTeacherIds = new Set(
        this.sessions()
          .filter(
            (session) =>
              session.campusId === campusId &&
              session.courseId === courseId &&
              session.assignmentStatus === 'assigned' &&
              !!session.teacherId,
          )
          .map((session) => session.teacherId)
          .filter((teacherId): teacherId is string => !!teacherId),
      );

      filteredTeachers = filteredTeachers.filter((teacher) => assignedTeacherIds.has(teacher.id));
    }
    return filteredTeachers;
  });

  protected readonly availableClasses = computed(() => {
    const campusId = this.selectedCampusId();
    const courseId = this.selectedCourseId();
    if (!campusId || !courseId) return [];
    return this.classes().filter((c) => c.campusId === campusId && c.courseId === courseId);
  });

  protected readonly hasActiveFilters = computed(
    () =>
      !!(
        this.selectedCourseId() ||
        this.selectedTeacherIds().length > 0 ||
        this.selectedClassId() ||
        (this.viewMode() === 'list' && this.listDateRangeModified()) ||
        (this.viewMode() === 'list' && this.showOnlyUnassigned())
      ),
  );

  protected readonly filteredSessions = computed(() => {
    const sessions = this.sessions();
    if (!this.showOnlyUnassigned()) return sessions;
    return sessions.filter(s => s.assignmentStatus === 'unassigned' && s.status === 'scheduled');
  });

  protected readonly weekStart = computed(() =>
    startOfWeek(this.currentDate(), { weekStartsOn: 1 }),
  );

  protected readonly weekEnd = computed(() => endOfWeek(this.currentDate(), { weekStartsOn: 1 }));

  protected readonly weekDays = computed(() =>
    Array.from({ length: 7 }, (_, i) => addDays(this.weekStart(), i)),
  );

  protected readonly weekLabel = computed(() => {
    const now = new Date();
    const weekOpts = { weekStartsOn: 1 as const };
    const start = this.weekStart();
    const end = this.weekEnd();
    const sameYear = start.getFullYear() === end.getFullYear();
    const startFmt = sameYear ? format(start, 'M/d') : format(start, 'yyyy/M/d');
    const endFmt = format(end, 'yyyy/M/d');
    const dateRange = sameYear
      ? `${format(start, 'yyyy')} · ${startFmt} – ${format(end, 'M/d')}`
      : `${startFmt} – ${endFmt}`;

    if (isSameWeek(start, now, weekOpts)) return `本週 · ${dateRange}`;
    if (isSameWeek(start, addWeeks(now, -1), weekOpts)) return `上週 · ${dateRange}`;
    if (isSameWeek(start, addWeeks(now, 1), weekOpts)) return `下週 · ${dateRange}`;
    return dateRange;
  });

  protected readonly dayLabel = computed(() => {
    const date = this.currentDate();
    const dateStr = format(date, 'yyyy/M/d (EEE)', { locale: zhTW });
    return isToday(date) ? `今天 · ${dateStr}` : dateStr;
  });

  protected readonly isCurrentPeriod = computed(() => {
    const now = new Date();
    if (this.isWeekView()) {
      return isSameWeek(this.currentDate(), now, { weekStartsOn: 1 });
    }
    return isToday(this.currentDate());
  });

  protected readonly activeTeachers = computed(() =>
    this.staff().filter((s) => s.roles.includes('teacher')),
  );

  // ── Selection state ─────────────────────────────────────────────────
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly selectedSessions = computed(() => {
    const selected = this.selectedIds();
    if (selected.size === 0) return [];
    return this.sessions().filter((session) => selected.has(session.id));
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

  // ── Context menu ─────────────────────────────────────────────────────
  protected readonly contextSession = signal<Session | null>(null);
  protected readonly contextMenuItems = computed<MenuItem[]>(() => {
    const s = this.contextSession();
    if (!s) return [];
    const items: MenuItem[] = [];

    if (s.status === 'scheduled') {
      items.push({
        label: '調課',
        icon: 'pi pi-calendar-clock',
        command: () => this.openReschedule(s),
      });
    }
    if (s.status === 'scheduled' && s.assignmentStatus === 'assigned') {
      items.push({
        label: '代課',
        icon: 'pi pi-user-edit',
        command: () => this.openSubstitute(s),
      });
    }
    if (s.assignmentStatus === 'unassigned' && s.status === 'scheduled') {
      items.push({
        label: '指派老師',
        icon: 'pi pi-user-plus',
        command: () => this.openAssignSingle(s),
      });
    }
    if (s.status === 'scheduled') {
      items.push({
        label: '停課',
        icon: 'pi pi-ban',
        command: () => this.openCancelDialog(s),
      });
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
    this.applyQueryParams();
    this.loadFilters();
    this.loadSessions();
    this.listenToResize();
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  protected prevPeriod(): void {
    if (this.isWeekView()) {
      this.currentDate.set(addWeeks(this.currentDate(), -1));
    } else {
      this.currentDate.set(addDays(this.currentDate(), -1));
    }
    this.loadSessions();
  }

  protected nextPeriod(): void {
    if (this.isWeekView()) {
      this.currentDate.set(addWeeks(this.currentDate(), 1));
    } else {
      this.currentDate.set(addDays(this.currentDate(), 1));
    }
    this.loadSessions();
  }

  protected goToday(): void {
    this.currentDate.set(new Date());
    this.loadSessions();
  }

  protected onDateJump(date: Date): void {
    this.currentDate.set(date);
    this.loadSessions();
  }

  // ── View toggle ──────────────────────────────────────────────────────
  protected toggleViewMode(mode: 'calendar' | 'list'): void {
    this.viewMode.set(mode);
    this.loadSessions();
  }

  // ── List view ───────────────────────────────────────────────────────
  protected onSelectedIdsChange(ids: string[]): void {
    this.selectedIds.set(new Set(ids));
  }

  protected onSessionListContextMenu(request: CalendarBodyContextMenuEvent): void {
    this.contextSession.set(request.session);
    this.sessionMenuRef()?.toggle(request.event);
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  // ── Batch dialog actions ──────────────────────────────────────────────
  protected openBatchSheet(initialMode: CalendarBodyBatchMode | null = null): void {
    const data: MobileBatchDialogData = {
      sessionIds: [...this.selectedIds()],
      selectedCount: this.selectedCount(),
      teachers: this.batchAssignableTeachers(),
      hasCancelledSelection: this.hasCancelledSelection(),
      initialMode,
    };
    const ref = this.dialogService.open(MobileBatchDialogComponent, {
      header: `已選 ${this.selectedCount()} 堂`,
      width: 'calc(var(--window-width, 360px) * 0.9)',
      style: { 'max-width': '400px' },
      closable: true,
      closeOnEscape: true,
      dismissableMask: true,
      data,
    });
    ref?.onClose.subscribe((result?: MobileBatchDialogResult) => {
      if (result?.action === 'applied') {
        this.clearSelection();
        this.loadSessions();
        const modeLabel: Record<string, string> = {
          cancel: '停課', uncancel: '取消停課', assign: '指派老師', time: '調整時間',
        };
        const label = modeLabel[result.mode] ?? '更新';
        const detail = result.skipped > 0
          ? `已${label} ${result.updated} 堂，略過 ${result.skipped} 堂`
          : `已${label} ${result.updated} 堂`;
        this.messageService.add({ severity: 'success', summary: '批次操作完成', detail });
      }
    });
  }

  protected toggleMobileFilters(): void {
    const data: MobileFilterDialogData = {
      campuses: this.campuses(),
      courses: this.courses(),
      teachers: this.activeTeachers(),
      sessions: this.sessions(),
      classes: this.classes(),
      selectedCampusId: this.selectedCampusId(),
      selectedCourseId: this.selectedCourseId(),
      selectedTeacherIds: this.selectedTeacherIds(),
      selectedClassId: this.selectedClassId(),
    };
    const ref = this.dialogService.open(MobileFilterDialogComponent, {
      header: '篩選條件',
      width: 'calc(var(--window-width, 360px) * 0.9)',
      style: { 'max-width': '400px' },
      closable: true,
      closeOnEscape: true,
      dismissableMask: true,
      data,
    });
    ref?.onClose.subscribe((result?: MobileFilterDialogResult) => {
      if (result) {
        this.selectedCampusId.set(result.campusId);
        this.selectedCourseId.set(result.courseId);
        this.selectedTeacherIds.set(result.teacherIds);
        this.selectedClassId.set(result.classId);
        this.loadSessions();
      }
    });
  }

  // ── Single-session actions ───────────────────────────────────────────
  protected openReschedule(session: Session): void {
    const ref = this.dialogService.open(SessionRescheduleDialogComponent, {
      header: '調課',
      width: '400px',
      data: { session },
      styleClass: 'cal-dialog',
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
      styleClass: 'cal-dialog',
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
      styleClass: 'cal-dialog',
    });
    ref?.onClose.subscribe((result?: { result: string } | string) => {
      const didRefresh = typeof result === 'string' ? result === 'refresh' : result?.result === 'refresh';
      if (didRefresh) {
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '已停課',
          detail: '如需安排補課，請至課堂管理中心的清單視圖新增調課',
          life: 6000,
        });
      }
    });
  }

  protected uncancelSingle(session: Session): void {
    this.calendarActionsService.uncancelSingle(session.id).subscribe({
      next: () => {
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '已取消停課',
          detail: `${session.className} ${session.sessionDate}`,
        });
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '操作失敗',
          detail: '無法取消停課',
        });
      },
    });
  }

  protected openAssignSingle(session: Session): void {
    const eligibleTeachers = this.getEligibleTeachersForSession(session);

    const ref = this.dialogService.open(SessionAssignDialogComponent, {
      header: '指派老師',
      width: '400px',
      data: {
        session,
        ...(eligibleTeachers.length > 0 ? { teachers: eligibleTeachers } : {}),
      },
      styleClass: 'cal-dialog',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  // ── Filters ────────────────────────────────────────────────────────────
  protected onCampusChange(campusId: string | null): void {
    this.selectedCampusId.set(campusId);
    this.selectedCourseId.set(null);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
    this.loadSessions();
  }

  protected onCourseChange(courseId: string | null): void {
    this.selectedCourseId.set(courseId);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
    this.loadSessions();
  }

  protected onTeacherIdsChange(ids: string[]): void {
    this.selectedTeacherIds.set(ids);
    this.loadSessions();
  }

  protected onClassChange(classId: string | null): void {
    this.selectedClassId.set(classId);
    this.loadSessions();
  }

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRange.set(range);
    this.listDateRangeModified.set(true);
    if (range.length === 2) {
      this.loadSessions();
    }
  }

  protected clearFilters(): void {
    this.selectedCourseId.set(null);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
    this.showOnlyUnassigned.set(false);
    this.listDateRange.set(this.getDefaultListDateRange());
    this.listDateRangeModified.set(false);
    this.loadSessions();
  }

  protected onCalendarGridOverflow(event: CalendarBodyOverflowEvent): void {
    this.openOverflowDialog(event.startTime, event.sessions);
  }

  // ── Detail popup ───────────────────────────────────────────────────────
  protected openDetail(session: Session): void {
    const ref = this.dialogService.open(SessionDetailDialogComponent, {
      header: '課程詳情',
      width: '400px',
      data: { session, loadingChanges: true, changes: [] },
      styleClass: 'cal-dialog',
    });

    if (ref) {
      ref.onClose.subscribe((result) => {
        if (result === 'refresh' || result === 'cancelled') {
          this.loadSessions();
        }
        if (result === 'cancelled') {
          this.messageService.add({
            severity: 'success',
            summary: '已停課',
            detail: '如需安排補課，請至課堂管理中心的清單視圖新增調課',
            life: 6000,
          });
        }
      });
    }
  }

  protected openOverflowDialog(startTime: string, sessions: Session[]): void {
    this.dialogService.open(SessionOverflowDialogComponent, {
      header: `${startTime} 重疊課程`,
      width: '400px',
      contentStyle: { padding: '1rem', 'padding-bottom': '1rem' },
      data: { startTime, sessions },
      styleClass: 'cal-dialog',
    });
  }

  // ── Private ────────────────────────────────────────────────────────────
  private applyQueryParams(): void {
    const params = this.route.snapshot.queryParams;
    const viewParam = params['view'];
    if (viewParam === 'calendar' || viewParam === 'list') {
      this.viewMode.set(viewParam);
    }
    if (params['campusId']) {
      this.selectedCampusId.set(params['campusId']);
    }
    if (params['courseId']) {
      this.selectedCourseId.set(params['courseId']);
    }
    if (params['classId']) {
      this.selectedClassId.set(params['classId']);
    }
    if (params['from']) {
      const fromDate = new Date(params['from']);
      this.currentDate.set(fromDate);
      if (params['to']) {
        this.listDateRange.set([fromDate, new Date(params['to'])]);
      } else {
        this.listDateRange.set([fromDate, endOfMonth(fromDate)]);
      }
    }
    if (params['assignmentStatus'] === 'unassigned') {
      this.showOnlyUnassigned.set(true);
    }
  }

  private getDefaultListDateRange(): Date[] {
    const now = new Date();
    return [now, endOfMonth(now)];
  }

  private getEligibleTeachersForSession(session: Session): Staff[] {
    const campusTeachers = this.activeTeachers().filter((teacher) =>
      teacher.campusIds.includes(session.campusId),
    );
    const course = this.courses().find((item) => item.id === session.courseId);
    if (!course) return campusTeachers;
    return campusTeachers.filter((teacher) => teacher.subjectIds.includes(course.subjectId));
  }

  private listenToResize(): void {
    fromEvent(window, 'resize')
      .pipe(debounceTime(150), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const isWide = window.innerWidth >= 768;
        if (this.isWeekView() !== isWide) {
          this.isWeekView.set(isWide);
          // Only reload for calendar view; list view has its own date range
          if (this.viewMode() === 'calendar') {
            this.loadSessions();
          }
        }
      });
  }

  private loadFilters(): void {
    this.campusesService.list({ isActive: true, pageSize: 100 }).subscribe({
      next: (res) => {
        this.campuses.set(res.data);
        if (res.data.length > 0 && !this.selectedCampusId()) {
          this.selectedCampusId.set(res.data[0].id);
          this.loadSessions();
        }
      },
    });
    this.coursesService.list({ isActive: true, pageSize: 200 }).subscribe({
      next: (res) => this.courses.set(res.data),
    });
    this.staffService.list({ isActive: true, pageSize: 200 }).subscribe({
      next: (res) => this.staff.set(res.data),
    });
    this.classesService.list({ isActive: true, pageSize: 500 }).subscribe({
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

  private loadSessions(): void {
    let from: string;
    let to: string;
    let teacherId: string | undefined;
    let teacherIds: string[] | undefined;

    if (this.viewMode() === 'list') {
      // List view: use independent date range + multi-teacher
      const range = this.listDateRange();
      from = range.length > 0 ? format(range[0], 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
      to = range.length > 1 ? format(range[1], 'yyyy-MM-dd') : from;
      const ids = this.selectedTeacherIds();
      if (ids.length > 0) teacherIds = ids;
    } else {
      // Calendar view: use week/day + single teacher (first from array)
      from = this.isWeekView()
        ? format(this.weekStart(), 'yyyy-MM-dd')
        : format(this.currentDate(), 'yyyy-MM-dd');
      to = this.isWeekView()
        ? format(this.weekEnd(), 'yyyy-MM-dd')
        : format(this.currentDate(), 'yyyy-MM-dd');
      const ids = this.selectedTeacherIds();
      if (ids.length === 1) teacherId = ids[0];
      else if (ids.length > 1) teacherId = ids[0]; // calendar only uses first
    }

    this.loading.set(true);
    this.sessionsService
      .list({
        from,
        to,
        campusId: this.selectedCampusId() ?? undefined,
        courseId: this.selectedCourseId() ?? undefined,
        teacherId,
        teacherIds,
        classId: this.selectedClassId() ?? undefined,
      })
      .subscribe({
        next: (res) => {
          this.sessions.set(res.data);
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
}
