import {
  Component,
  DestroyRef,
  OnInit,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  isSameWeek,
  isToday,
  startOfWeek,
} from 'date-fns';
import { debounceTime, fromEvent } from 'rxjs';
import { zhTW } from 'date-fns/locale';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
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
import { Campus, CampusesService } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { Course, CoursesService } from '@core/courses.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { Session, SessionsService, ScheduleChange } from '@core/sessions.service';
import { Staff, StaffService } from '@core/staff.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
import { SessionOverflowDialogComponent } from './dialogs/session-overflow-dialog/session-overflow-dialog.component';

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
    DatePickerModule,
    DialogModule,
    ToastModule,
    TagModule,
    SkeletonModule,
    TooltipModule,
    CheckboxModule,
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
  private readonly authService = inject(AuthService); // Added authService injection

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

  // ── Filter state ───────────────────────────────────────────────────────
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly selectedCourseId = signal<string | null>(null);
  protected readonly selectedTeacherId = signal<string | null>(null);
  protected readonly selectedClassId = signal<string | null>(null);

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
    () => !!(this.selectedCourseId() || this.selectedTeacherId() || this.selectedClassId()),
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
    const dateRange = `${format(start, 'M/d')} – ${format(end, 'M/d')}`;

    if (isSameWeek(start, now, weekOpts)) return `本週 · ${dateRange}`;
    if (isSameWeek(start, addWeeks(now, -1), weekOpts)) return `上週 · ${dateRange}`;
    if (isSameWeek(start, addWeeks(now, 1), weekOpts)) return `下週 · ${dateRange}`;
    return dateRange;
  });

  protected readonly dayLabel = computed(() => {
    const date = this.currentDate();
    const dateStr = format(date, 'M/d (EEE)', { locale: zhTW });
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

  // ── Lifecycle ──────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.loadFilters();
    this.loadSessions();
    this.listenToResize();
  }

  ngOnDestroy(): void {
    // No explicit cleanup needed for takeUntilDestroyed, but good to have the method if needed later.
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

  // ── Filters ────────────────────────────────────────────────────────────
  protected onCampusChange(campusId: string | null): void {
    this.selectedCampusId.set(campusId);
    this.selectedCourseId.set(null);
    this.selectedTeacherId.set(null);
    this.selectedClassId.set(null);
    this.loadSessions();
  }

  protected onCourseChange(courseId: string | null): void {
    this.selectedCourseId.set(courseId);
    this.selectedTeacherId.set(null);
    this.selectedClassId.set(null);
    this.loadSessions();
  }

  protected onTeacherChange(teacherId: string | null): void {
    this.selectedTeacherId.set(teacherId);
    this.loadSessions();
  }

  protected onClassChange(classId: string | null): void {
    this.selectedClassId.set(classId);
    this.loadSessions();
  }

  protected clearFilters(): void {
    this.selectedCourseId.set(null);
    this.selectedTeacherId.set(null);
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
  private listenToResize(): void {
    fromEvent(window, 'resize')
      .pipe(debounceTime(150), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const isWide = window.innerWidth >= 768;
        if (this.isWeekView() !== isWide) {
          this.isWeekView.set(isWide);
          this.loadSessions();
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
    const from = this.isWeekView()
      ? format(this.weekStart(), 'yyyy-MM-dd')
      : format(this.currentDate(), 'yyyy-MM-dd');
    const to = this.isWeekView()
      ? format(this.weekEnd(), 'yyyy-MM-dd')
      : format(this.currentDate(), 'yyyy-MM-dd');

    this.loading.set(true);
    this.sessionsService
      .list({
        from,
        to,
        campusId: this.selectedCampusId() ?? undefined,
        courseId: this.selectedCourseId() ?? undefined,
        teacherId: this.selectedTeacherId() ?? undefined,
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
