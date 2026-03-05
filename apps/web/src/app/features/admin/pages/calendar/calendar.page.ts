import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { MenuModule } from 'primeng/menu';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { DrawerModule } from 'primeng/drawer';
import { DialogService } from 'primeng/dynamicdialog';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePaginationConfig,
  ResponsiveTablePageEvent,
} from '@shared/components/responsive-table/responsive-table.models';
import { OverlayContainerDirective } from '@shared/directives/overlay-container.directive';

import { AuthService } from '@core/auth.service';
import { BrowserStateService } from '@core/browser-state.service';
import { Campus, CampusesService } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { Course, CoursesService } from '@core/courses.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  Session,
  SessionsService,
  ScheduleChange,
  type BatchAssignResult,
  type BatchActionResult,
} from '@core/sessions.service';
import { Staff, StaffService } from '@core/staff.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SessionCancelDialogComponent } from './dialogs/session-cancel-dialog/session-cancel-dialog.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
import { SessionOverflowDialogComponent } from './dialogs/session-overflow-dialog/session-overflow-dialog.component';
import { SessionRescheduleDialogComponent } from './dialogs/session-reschedule-dialog/session-reschedule-dialog.component';
import { SessionSubstituteDialogComponent } from './dialogs/session-substitute-dialog/session-substitute-dialog.component';

const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 22;
const SLOT_HEIGHT_PX = 36;

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    SelectModule,
    MultiSelectModule,
    DatePickerModule,
    DialogModule,
    ToastModule,
    TagModule,
    SkeletonModule,
    TooltipModule,
    MenuModule,
    InputTextModule,
    CheckboxModule,
    DrawerModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './calendar.page.html',
  styleUrl: './calendar.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPage implements OnInit, OnDestroy {
  readonly page = input.required<RouteObj>();

  private readonly campusesService = inject(CampusesService);
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly staffService = inject(StaffService);
  private readonly sessionsService = inject(SessionsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly dialogService = inject(DialogService);
  private readonly authService = inject(AuthService);
  private readonly browserStateService = inject(BrowserStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly elementRef = inject(ElementRef);

  protected readonly isMobile = this.browserStateService.isMobile;
  protected readonly showBatchSheet = signal(false);
  protected readonly showMobileFilters = signal(false);

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseId()) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.selectedClassId()) count++;
    return count;
  });

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // ── View state (signals) ───────────────────────────────────────────────
  protected readonly currentDate = signal(new Date());
  protected readonly isWeekView = signal(window.innerWidth >= 768);
  protected readonly viewMode = signal<'calendar' | 'list'>('calendar');
  protected readonly loading = signal(false);
  protected readonly sessions = signal<Session[]>([]);

  // Filter options (signals)
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly courses = signal<Course[]>([]);
  protected readonly staff = signal<Staff[]>([]);
  protected readonly classes = signal<Array<{ id: string; name: string; courseId: string; campusId: string }>>([]);

  // Date picker popup
  protected readonly showDatePicker = signal(false);
  private readonly datepickerPopupRef = viewChild<ElementRef<HTMLElement>>('datepickerPopup');
  private readonly subtitleButtonRef = viewChild<ElementRef<HTMLElement>>('subtitleButton');

  // ── Filter state ───────────────────────────────────────────────────────
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedCourseId = signal<string | null>(null);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedClassId = signal<string | null>(null);

  // ── List view date range (independent from calendar week/day) ──────────
  protected readonly listDateRange = signal<Date[]>(this.getDefaultListDateRange());

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
    }
    return filteredTeachers;
  });

  protected readonly availableClasses = computed(() => {
    const campusId = this.selectedCampusId();
    const courseId = this.selectedCourseId();
    if (!campusId) return [];
    let filtered = this.classes().filter((c) => c.campusId === campusId);
    if (courseId) filtered = filtered.filter((c) => c.courseId === courseId);
    return filtered;
  });

  protected readonly hasActiveFilters = computed(
    () => !!(this.selectedCourseId() || this.selectedTeacherIds().length > 0 || this.selectedClassId()),
  );

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

  protected readonly timeSlots = computed(() => {
    const slots: string[] = [];
    for (let h = CALENDAR_START_HOUR; h < CALENDAR_END_HOUR; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
      slots.push(`${String(h).padStart(2, '0')}:30`);
    }
    return slots;
  });

  protected readonly gridHeight = computed(
    () => (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 2 * SLOT_HEIGHT_PX,
  );

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

  // ── List view state ─────────────────────────────────────────────────
  private readonly listFirst = signal(0);
  private readonly listRows = signal(20);

  protected readonly listPagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: this.listFirst(),
    rows: this.listRows(),
    totalRecords: this.sessions().length,
    rowsPerPageOptions: [20, 50, 100],
  }));

  protected readonly paginatedSessions = computed(() => {
    const all = this.sessions();
    const first = this.listFirst();
    const rows = this.listRows();
    return all.slice(first, first + rows);
  });

  // ── Selection state ─────────────────────────────────────────────────
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly allPageSelected = computed(() => {
    const page = this.paginatedSessions();
    if (page.length === 0) return false;
    const ids = this.selectedIds();
    return page.every((s) => ids.has(s.id));
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

  // ── Batch operations ─────────────────────────────────────────────────
  protected readonly batchMode = signal<'assign' | 'time' | 'cancel' | 'uncancel' | null>(null);
  protected readonly batchTeacherId = signal<string | null>(null);
  protected readonly batchStartTime = signal('09:00');
  protected readonly batchEndTime = signal('11:00');
  protected readonly batchCancelReason = signal('');
  protected readonly batchPreview = signal<BatchAssignResult | BatchActionResult | null>(null);
  protected readonly batchLoading = signal(false);

  // ── Lifecycle ──────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.applyQueryParams();
    this.loadFilters();
    this.loadSessions();
    this.listenToResize();
  }

  ngOnDestroy(): void {
    // No explicit cleanup needed for takeUntilDestroyed
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.showDatePicker()) {
      const target = event.target as HTMLElement;
      const popupEl = this.datepickerPopupRef()?.nativeElement;
      const buttonEl = this.subtitleButtonRef()?.nativeElement;
      if (popupEl && !popupEl.contains(target) && buttonEl && !buttonEl.contains(target)) {
        this.showDatePicker.set(false);
      }
    }
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

  protected toggleDatePicker(): void {
    this.showDatePicker.update((v) => !v);
  }

  protected onDateJump(date: Date): void {
    this.currentDate.set(date);
    this.showDatePicker.set(false);
    this.loadSessions();
  }

  // ── View toggle ──────────────────────────────────────────────────────
  protected toggleViewMode(mode: 'calendar' | 'list'): void {
    this.viewMode.set(mode);
    this.loadSessions();
  }

  // ── List view ───────────────────────────────────────────────────────
  protected onListPage(event: ResponsiveTablePageEvent): void {
    this.listFirst.set(event.first);
    this.listRows.set(event.rows);
  }

  protected toggleSelectAll(): void {
    const page = this.paginatedSessions();
    const ids = new Set(this.selectedIds());
    if (this.allPageSelected()) {
      page.forEach((s) => ids.delete(s.id));
    } else {
      page.forEach((s) => ids.add(s.id));
    }
    this.selectedIds.set(ids);
  }

  protected toggleSelect(sessionId: string): void {
    const ids = new Set(this.selectedIds());
    if (ids.has(sessionId)) ids.delete(sessionId);
    else ids.add(sessionId);
    this.selectedIds.set(ids);
  }

  protected isSelected(sessionId: string): boolean {
    return this.selectedIds().has(sessionId);
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected getDayLabel(dateStr: string): string {
    const DAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return DAY_LABELS[new Date(dateStr).getDay()];
  }

  // ── Batch panel actions ──────────────────────────────────────────────
  protected openBatchPanel(mode: 'assign' | 'time' | 'cancel' | 'uncancel'): void {
    this.batchMode.set(mode);
    this.batchPreview.set(null);
  }

  protected closeBatchPanel(): void {
    this.batchMode.set(null);
    this.batchPreview.set(null);
    this.batchTeacherId.set(null);
    this.batchCancelReason.set('');
  }

  protected openBatchSheet(): void {
    this.showBatchSheet.set(true);
  }

  protected closeBatchSheet(): void {
    this.showBatchSheet.set(false);
    this.closeBatchPanel();
  }

  protected selectBatchAction(mode: 'assign' | 'time' | 'cancel' | 'uncancel'): void {
    this.openBatchPanel(mode);
  }

  protected toggleMobileFilters(): void {
    this.showMobileFilters.update((v) => !v);
  }

  protected closeMobileFilters(): void {
    this.showMobileFilters.set(false);
  }

  protected runBatchPreview(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    this.batchLoading.set(true);

    const mode = this.batchMode();
    let obs: import('rxjs').Observable<BatchAssignResult | BatchActionResult>;

    switch (mode) {
      case 'assign':
        obs = this.sessionsService.batchAssignTeacher({
          sessionIds: ids,
          teacherId: this.batchTeacherId()!,
          dryRun: true,
        });
        break;
      case 'time':
        obs = this.sessionsService.batchUpdateTime({
          sessionIds: ids,
          startTime: this.batchStartTime(),
          endTime: this.batchEndTime(),
          dryRun: true,
        });
        break;
      case 'cancel':
        obs = this.sessionsService.batchCancel({
          sessionIds: ids,
          reason: this.batchCancelReason() || undefined,
          dryRun: true,
        });
        break;
      case 'uncancel':
        obs = this.sessionsService.batchUncancel({ sessionIds: ids, dryRun: true });
        break;
      default:
        return;
    }

    obs.subscribe({
      next: (result) => {
        this.batchPreview.set(result);
        this.batchLoading.set(false);
      },
      error: () => {
        this.batchLoading.set(false);
        this.messageService.add({ severity: 'error', summary: '預覽失敗', detail: '無法執行預覽' });
      },
    });
  }

  protected applyBatch(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    this.batchLoading.set(true);

    const mode = this.batchMode();
    let obs: import('rxjs').Observable<BatchAssignResult | BatchActionResult>;

    switch (mode) {
      case 'assign':
        obs = this.sessionsService.batchAssignTeacher({
          sessionIds: ids,
          teacherId: this.batchTeacherId()!,
          dryRun: false,
        });
        break;
      case 'time':
        obs = this.sessionsService.batchUpdateTime({
          sessionIds: ids,
          startTime: this.batchStartTime(),
          endTime: this.batchEndTime(),
          dryRun: false,
        });
        break;
      case 'cancel':
        obs = this.sessionsService.batchCancel({
          sessionIds: ids,
          reason: this.batchCancelReason() || undefined,
          dryRun: false,
        });
        break;
      case 'uncancel':
        obs = this.sessionsService.batchUncancel({ sessionIds: ids, dryRun: false });
        break;
      default:
        return;
    }

    obs.subscribe({
      next: (result) => {
        this.batchLoading.set(false);
        const updated = 'updated' in result ? result.updated : 0;
        this.showBatchSheet.set(false);
        this.closeBatchPanel();
        this.clearSelection();
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '批次操作完成',
          detail: `已更新 ${updated} 堂課`,
        });
      },
      error: () => {
        this.batchLoading.set(false);
        this.messageService.add({ severity: 'error', summary: '操作失敗', detail: '批次操作失敗' });
      },
    });
  }

  protected getProcessableCount(): number {
    const preview = this.batchPreview();
    if (!preview) return 0;
    if ('skippedConflicts' in preview) {
      // BatchAssignResult
      return preview.updated;
    }
    // BatchActionResult
    return preview.processableIds.length;
  }

  protected getSkippedCount(): number {
    const preview = this.batchPreview();
    if (!preview) return 0;
    if ('skippedConflicts' in preview) {
      return preview.skippedConflicts + preview.skippedNotEligible;
    }
    return preview.skipped;
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
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  protected uncancelSingle(session: Session): void {
    this.sessionsService.batchUncancel({ sessionIds: [session.id] }).subscribe({
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
    // Use batch assign with single session — simplified approach
    this.sessionsService
      .batchAssignTeacher({
        sessionIds: [session.id],
        teacherId: '', // Will be replaced when batch panel is ready (Task 8)
        dryRun: true,
      })
      .subscribe(); // placeholder — full assign UI in Task 8
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
    if (range.length === 2) {
      this.loadSessions();
    }
  }

  protected clearFilters(): void {
    this.selectedCourseId.set(null);
    this.selectedTeacherIds.set([]);
    this.selectedClassId.set(null);
    this.loadSessions();
  }

  // ── Grid helpers ───────────────────────────────────────────────────────
  protected getSessionTop(startTime: string): number {
    const [h, m] = startTime.split(':').map(Number);
    return ((h - CALENDAR_START_HOUR) * 2 + m / 30) * SLOT_HEIGHT_PX;
  }

  protected getSessionHeight(startTime: string, endTime: string): number {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    return Math.max((mins / 30) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX);
  }

  protected getSessionsForDay(day: Date): Session[] {
    const dateStr = format(day, 'yyyy-MM-dd');
    return this.sessions().filter((s) => s.sessionDate === dateStr);
  }

  protected getRenderSessionsForDay(day: Date): {
    slots: { session: Session; width: number; left: number }[];
    overflows: { startTime: string; count: number; sessions: Session[] }[];
  } {
    const daySessions = this.getSessionsForDay(day);
    if (daySessions.length === 0) return { slots: [], overflows: [] };

    // 1. Sort by start time, then end time
    const sorted = [...daySessions].sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
      return a.endTime.localeCompare(b.endTime);
    });

    // 2. Group into overlapping clusters
    const clusters: Session[][] = [];
    let currentCluster: Session[] = [];
    let clusterEnd = '';

    for (const s of sorted) {
      if (currentCluster.length === 0) {
        currentCluster.push(s);
        clusterEnd = s.endTime;
      } else {
        if (s.startTime < clusterEnd) {
          currentCluster.push(s);
          if (s.endTime > clusterEnd) clusterEnd = s.endTime;
        } else {
          clusters.push(currentCluster);
          currentCluster = [s];
          clusterEnd = s.endTime;
        }
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    // 3. Calculate columns for each cluster
    const MAX_COLS = 3;
    const slots: { session: Session; width: number; left: number }[] = [];
    const overflowsMap = new Map<string, Session[]>();

    for (const cluster of clusters) {
      const columns: Session[][] = [];

      for (const s of cluster) {
        let placed = false;
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          const lastInCol = col[col.length - 1];
          if (s.startTime >= lastInCol.endTime) {
            col.push(s);
            placed = true;
            break;
          }
        }
        if (!placed) {
          columns.push([s]);
        }
      }

      // Check if we exceed MAX_COLS
      if (columns.length > MAX_COLS) {
        // Render first 2 columns normally, collect everything else into overflow badges by start time
        for (let i = 0; i < 2; i++) {
          for (const s of columns[i]) {
            slots.push({ session: s, width: 100 / MAX_COLS, left: (i * 100) / MAX_COLS });
          }
        }
        for (let i = 2; i < columns.length; i++) {
          for (const s of columns[i]) {
            const timeKey = s.startTime;
            if (!overflowsMap.has(timeKey)) {
              overflowsMap.set(timeKey, []);
            }
            overflowsMap.get(timeKey)!.push(s);
          }
        }
      } else {
        // Less than or equal to 3 columns, render normally
        const colCount = columns.length;
        for (let i = 0; i < colCount; i++) {
          for (const s of columns[i]) {
            slots.push({ session: s, width: 100 / colCount, left: (i * 100) / colCount });
          }
        }
      }
    }

    // Format overflows
    const overflows = Array.from(overflowsMap.entries()).map(([startTime, sessions]) => ({
      startTime,
      count: sessions.length,
      sessions,
    }));

    return { slots, overflows };
  }

  protected isToday(day: Date): boolean {
    return isToday(day);
  }

  protected dayOfWeekLabel(day: Date): string {
    return format(day, 'EEE', { locale: zhTW });
  }

  protected dayOfMonthLabel(day: Date): string {
    return format(day, 'd');
  }

  protected isHourMark(slot: string): boolean {
    return slot.endsWith(':00');
  }

  // ── Status helpers ─────────────────────────────────────────────────────
  protected sessionStatusLabel(s: Session): string {
    if (s.status === 'cancelled') return '停課';
    if (s.hasChanges) return '已調整';
    return '正常';
  }

  protected sessionStatusSeverity(s: Session): 'info' | 'secondary' | 'warn' {
    if (s.status === 'cancelled') return 'secondary';
    if (s.hasChanges) return 'warn';
    return 'info';
  }

  protected canOperate(session: Session | null): boolean {
    return !!session && session.status !== 'cancelled';
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
        // If a dialog closed with 'refresh', reload sessions
        if (result === 'refresh') {
          this.loadSessions();
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
    if (params['view'] === 'list') {
      this.viewMode.set('list');
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
  }

  private getDefaultListDateRange(): Date[] {
    const now = new Date();
    return [now, endOfMonth(now)];
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
