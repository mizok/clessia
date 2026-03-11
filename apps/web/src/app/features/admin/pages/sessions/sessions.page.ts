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
import { format } from 'date-fns';
import { MessageService, type MenuItem } from 'primeng/api';
import { MenuModule, type Menu } from 'primeng/menu';
import { ToastModule } from 'primeng/toast';
import { DialogService } from 'primeng/dynamicdialog';

import { CampusesService, type Campus } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService, type Course } from '@core/courses.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { SessionsService, type Session } from '@core/sessions.service';
import { StaffService, type Staff } from '@core/staff.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SessionCancelDialogComponent } from './dialogs/session-cancel-dialog/session-cancel-dialog.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
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
import {
  SessionsBodyComponent,
  type SessionsBodyBatchMode,
  type SessionsBodyContextMenuEvent,
} from './components/sessions-body/sessions-body.component';
import { SessionsActionsService } from './services/sessions-actions.service';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [
    ToastModule,
    MenuModule,
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

  private readonly campusesService = inject(CampusesService);
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly staffService = inject(StaffService);
  private readonly sessionsService = inject(SessionsService);
  private readonly sessionsActionsService = inject(SessionsActionsService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly dialogService = inject(DialogService);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // ── View state ─────────────────────────────────────────────────────────
  protected readonly loading = signal(false);
  protected readonly sessions = signal<Session[]>([]);

  // Filter options
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly courses = signal<Course[]>([]);
  protected readonly staff = signal<Staff[]>([]);
  protected readonly classes = signal<
    Array<{ id: string; name: string; courseId: string; campusId: string }>
  >([]);

  private readonly sessionMenuRef = viewChild<Menu>('sessionMenu');

  // ── Filter state ───────────────────────────────────────────────────────
  protected readonly selectedCampusIds = signal<string[]>([]);
  protected readonly selectedCourseIds = signal<string[]>([]);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedClassIds = signal<string[]>([]);
  protected readonly selectedStatuses = signal<string[]>([...DEFAULT_STATUSES]);
  protected readonly currentPage = signal(1);
  protected readonly totalSessions = signal(0);
  protected readonly PAGE_SIZE = 50;

  // ── List date range ────────────────────────────────────────────────────
  protected readonly listDateRange = signal<Date[]>([]);
  protected readonly listDateRangeModified = signal(false);

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

      const assignedTeacherIds = new Set(
        this.sessions()
          .filter(
            (s) =>
              campusIds.includes(s.campusId) &&
              courseIds.includes(s.courseId) &&
              s.assignmentStatus === 'assigned' &&
              !!s.teacherId,
          )
          .map((s) => s.teacherId)
          .filter((id): id is string => !!id),
      );
      filtered = filtered.filter((t) => assignedTeacherIds.has(t.id));
    }
    return filtered;
  });

  protected readonly availableClasses = computed(() => {
    const campusIds = this.selectedCampusIds();
    const courseIds = this.selectedCourseIds();
    if (campusIds.length === 0 || courseIds.length === 0) return [];
    return this.classes().filter(
      (c) => campusIds.includes(c.campusId) && courseIds.includes(c.courseId),
    );
  });

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseIds().length > 0) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.selectedClassIds().length > 0) count++;
    if (this.listDateRangeModified()) count++;
    if (!this.isDefaultStatuses()) count++;
    return count;
  });

  protected readonly hasActiveFilters = computed(
    () =>
      this.selectedCourseIds().length > 0 ||
      this.selectedTeacherIds().length > 0 ||
      this.selectedClassIds().length > 0 ||
      this.listDateRangeModified() ||
      !this.isDefaultStatuses(),
  );

  protected readonly unassignedCount = signal(0);

  // ── Selection state ────────────────────────────────────────────────────
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

  // ── Context menu ───────────────────────────────────────────────────────
  protected readonly contextSession = signal<Session | null>(null);
  protected readonly contextMenuItems = computed<MenuItem[]>(() => {
    const s = this.contextSession();
    if (!s) return [];
    const items: MenuItem[] = [
      { label: '查看異動紀錄', icon: 'pi pi-eye', command: () => this.openDetail(s) },
    ];
    if (s.status === 'scheduled') {
      items.push({ label: '調課', icon: 'pi pi-arrows-h', command: () => this.openReschedule(s) });
    }
    if (s.status === 'scheduled' && s.assignmentStatus === 'assigned') {
      items.push({ label: '代課', icon: 'pi pi-user-edit', command: () => this.openSubstitute(s) });
    }
    if (s.assignmentStatus === 'unassigned' && s.status === 'scheduled') {
      items.push({ label: '指派老師', icon: 'pi pi-user-plus', command: () => this.openAssignSingle(s) });
    }
    if (s.status === 'scheduled') {
      items.push({ label: '停課', icon: 'pi pi-ban', command: () => this.openCancelDialog(s) });
    }
    if (s.status === 'cancelled') {
      items.push({ label: '取消停課', icon: 'pi pi-replay', command: () => this.uncancelSingle(s) });
    }
    return items;
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.loadFilters();
    this.loadSessions();
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
      width: 'calc(var(--window-width, 360px) * 0.9)',
      style: { 'max-width': '400px' },
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
          cancel: '停課', uncancel: '取消停課', assign: '指派老師', time: '調整時間',
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

  protected toggleMobileFilters(): void {
    const data: MobileFilterDialogData = {
      campuses: this.campuses(),
      courses: this.courses(),
      teachers: this.activeTeachers(),
      sessions: this.sessions(),
      classes: this.classes(),
      selectedCampusIds: this.selectedCampusIds(),
      selectedCourseIds: this.selectedCourseIds(),
      selectedTeacherIds: this.selectedTeacherIds(),
      selectedClassIds: this.selectedClassIds(),
      selectedStatuses: this.selectedStatuses(),
    };
    const ref = this.dialogService.open(MobileFilterDialogComponent, {
      header: '篩選條件',
      width: 'calc(var(--window-width, 360px) * 0.9)',
      style: { 'max-width': '400px' },
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
        this.selectedStatuses.set(result.statuses);
        this.loadSessions();
      }
    });
  }

  // ── Single-session actions ─────────────────────────────────────────────
  protected openReschedule(session: Session): void {
    const ref = this.dialogService.open(SessionRescheduleDialogComponent, {
      header: '調課', width: '400px', data: { session }, styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => { if (result === 'refresh') this.loadSessions(); });
  }

  protected openSubstitute(session: Session): void {
    const ref = this.dialogService.open(SessionSubstituteDialogComponent, {
      header: '安排代課', width: '400px', data: { session }, styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => { if (result === 'refresh') this.loadSessions(); });
  }

  protected openCancelDialog(session: Session): void {
    const ref = this.dialogService.open(SessionCancelDialogComponent, {
      header: '停課', width: '400px', data: { session }, styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result?: { result: string } | string) => {
      const didRefresh = typeof result === 'string' ? result === 'refresh' : result?.result === 'refresh';
      if (didRefresh) {
        this.loadSessions();
        this.messageService.add({ severity: 'success', summary: '已停課', detail: '如需安排補課，請新增調課', life: 6000 });
      }
    });
  }

  protected uncancelSingle(session: Session): void {
    this.sessionsActionsService.uncancelSingle(session.id).subscribe({
      next: () => {
        this.loadSessions();
        this.messageService.add({ severity: 'success', summary: '已取消停課', detail: `${session.className} ${session.sessionDate}` });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '操作失敗', detail: '無法取消停課' });
      },
    });
  }

  protected openAssignSingle(session: Session): void {
    const eligibleTeachers = this.getEligibleTeachersForSession(session);
    const ref = this.dialogService.open(SessionAssignDialogComponent, {
      header: '指派老師', width: '400px',
      data: { session, ...(eligibleTeachers.length > 0 ? { teachers: eligibleTeachers } : {}) },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => { if (result === 'refresh') this.loadSessions(); });
  }

  // ── Filters ────────────────────────────────────────────────────────────
  protected onCampusIdsChange(ids: string[]): void {
    this.currentPage.set(1);
    this.selectedCampusIds.set(ids);
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.loadSessions();
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
    if (range.length === 2) {
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
    this.selectedTeacherIds.set(['__unassigned__']);
    this.loadSessions();
  }

  protected clearFilters(): void {
    this.currentPage.set(1);
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.listDateRange.set([]);
    this.listDateRangeModified.set(false);
    this.selectedStatuses.set([...DEFAULT_STATUSES]);
    this.loadSessions();
  }

  // ── Detail popup ───────────────────────────────────────────────────────
  protected openDetail(session: Session): void {
    this.dialogService.open(SessionDetailDialogComponent, {
      header: '異動紀錄', width: '400px',
      data: { session, loadingChanges: true, changes: [] }, styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
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


  private getEligibleTeachersForSession(session: Session): Staff[] {
    const campusTeachers = this.activeTeachers().filter((t) => t.campusIds.includes(session.campusId));
    const course = this.courses().find((c) => c.id === session.courseId);
    if (!course) return campusTeachers;
    return campusTeachers.filter((t) => t.subjectIds.includes(course.subjectId));
  }

  private loadFilters(): void {
    this.campusesService.list({ isActive: true, pageSize: 100 }).subscribe({
      next: (res) => {
        this.campuses.set(res.data);
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
        this.classes.set(res.data.map((c) => ({ id: c.id, name: c.name, courseId: c.courseId, campusId: c.campusId }))),
    });
  }

  private loadUnassignedCount(): void {
    const range = this.listDateRange();
    this.sessionsService
      .list({
        from: range.length > 0 ? format(range[0], 'yyyy-MM-dd') : undefined,
        to: range.length > 1 ? format(range[1], 'yyyy-MM-dd') : undefined,
        campusIds: this.selectedCampusIds().length > 0 ? this.selectedCampusIds() : undefined,
        courseIds: this.selectedCourseIds().length > 0 ? this.selectedCourseIds() : undefined,
        classId: this.selectedClassIds().length === 1 ? this.selectedClassIds()[0] : undefined,
        assignmentStatus: 'unassigned',
        statuses: ['scheduled'],
        pageSize: 1,
      })
      .subscribe({ next: (res) => this.unassignedCount.set(res.meta.total) });
  }

  private loadSessions(): void {
    this.loadUnassignedCount();
    const range = this.listDateRange();
    const rawIds = this.selectedTeacherIds();
    const realTeacherIds = rawIds.filter((id) => id !== '__unassigned__');
    const hasUnassigned = rawIds.includes('__unassigned__');

    this.loading.set(true);
    this.sessionsService
      .list({
        from: range.length > 0 ? format(range[0], 'yyyy-MM-dd') : undefined,
        to: range.length > 1 ? format(range[1], 'yyyy-MM-dd') : undefined,
        campusIds: this.selectedCampusIds().length > 0 ? this.selectedCampusIds() : undefined,
        courseIds: this.selectedCourseIds().length > 0 ? this.selectedCourseIds() : undefined,
        teacherIds: realTeacherIds.length > 0 ? realTeacherIds : undefined,
        assignmentStatus: hasUnassigned ? 'unassigned' : undefined,
        classId: this.selectedClassIds().length === 1 ? this.selectedClassIds()[0] : undefined,
        statuses: this.selectedStatuses().length > 0 ? this.selectedStatuses() : undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.sessions.set(res.data);
          this.totalSessions.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.messageService.add({ severity: 'error', summary: '載入失敗', detail: '無法載入課堂資料' });
        },
      });
  }
}
