import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { addDays, addWeeks, endOfWeek, format, isToday, startOfWeek } from 'date-fns';
import { debounceTime, fromEvent } from 'rxjs';
import { zhTW } from 'date-fns/locale';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import type { Campus } from '@core/campuses.service';
import { CampusesService } from '@core/campuses.service';
import type { Course } from '@core/courses.service';
import { CoursesService } from '@core/courses.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import type { ScheduleChange, Session } from '@core/sessions.service';
import { SessionsService } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { StaffService } from '@core/staff.service';

const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 22;
const SLOT_HEIGHT_PX = 36;

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    DialogModule,
    ToastModule,
    TagModule,
    SkeletonModule,
    TooltipModule,
  ],
  providers: [MessageService],
  templateUrl: './calendar.page.html',
  styleUrl: './calendar.page.scss',
})
export class CalendarPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly campusesService = inject(CampusesService);
  private readonly coursesService = inject(CoursesService);
  private readonly staffService = inject(StaffService);
  private readonly sessionsService = inject(SessionsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // ── View state (signals) ───────────────────────────────────────────────
  protected readonly currentDate = signal(new Date());
  protected readonly isWeekView = signal(window.innerWidth >= 768);
  protected readonly loading = signal(false);
  protected readonly sessions = signal<Session[]>([]);

  // Filter options (signals)
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly courses = signal<Course[]>([]);
  protected readonly staff = signal<Staff[]>([]);

  // Date picker popup
  protected readonly showDatePicker = signal(false);

  // Detail / change history (signals)
  protected readonly showDetail = signal(false);
  protected readonly selectedSession = signal<Session | null>(null);
  protected readonly sessionChanges = signal<ScheduleChange[]>([]);
  protected readonly loadingChanges = signal(false);

  // Operation loading states (signals)
  protected readonly cancelLoading = signal(false);
  protected readonly substituteLoading = signal(false);
  protected readonly rescheduleLoading = signal(false);

  // Dialog visibility (signals)
  protected readonly showCancelDialog = signal(false);
  protected readonly showSubstituteDialog = signal(false);
  protected readonly showRescheduleDialog = signal(false);

  // ── Form-bound properties (regular – ngModel compatible) ──────────────
  protected selectedCampusId: string | null = null;
  protected selectedCourseId: string | null = null;
  protected selectedTeacherId: string | null = null;

  protected cancelReason = '';

  protected substituteTeacherId: string | null = null;
  protected substituteReason = '';

  protected rescheduleDate: Date | null = null;
  protected rescheduleStartTime = '';
  protected rescheduleEndTime = '';
  protected rescheduleReason = '';

  // ── Computed ───────────────────────────────────────────────────────────
  protected readonly weekStart = computed(() =>
    startOfWeek(this.currentDate(), { weekStartsOn: 1 }),
  );

  protected readonly weekEnd = computed(() =>
    endOfWeek(this.currentDate(), { weekStartsOn: 1 }),
  );

  protected readonly weekDays = computed(() =>
    Array.from({ length: 7 }, (_, i) => addDays(this.weekStart(), i)),
  );

  protected readonly weekLabel = computed(
    () =>
      `${format(this.weekStart(), 'yyyy/MM/dd')} – ${format(this.weekEnd(), 'MM/dd')}`,
  );

  protected readonly dayLabel = computed(() =>
    format(this.currentDate(), 'yyyy/MM/dd (EEE)', { locale: zhTW }),
  );

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

  protected readonly activeTeachers = computed(() =>
    this.staff().filter((s) => s.roles.includes('teacher')),
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────
  ngOnInit(): void {
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

  protected toggleDatePicker(): void {
    this.showDatePicker.update((v) => !v);
  }

  protected onDateJump(date: Date): void {
    this.currentDate.set(date);
    this.showDatePicker.set(false);
    this.loadSessions();
  }

  // ── Filters ────────────────────────────────────────────────────────────
  protected onFilterChange(): void {
    this.loadSessions();
  }

  protected clearFilters(): void {
    this.selectedCampusId = null;
    this.selectedCourseId = null;
    this.selectedTeacherId = null;
    this.loadSessions();
  }

  protected hasActiveFilters(): boolean {
    return !!(this.selectedCampusId || this.selectedCourseId || this.selectedTeacherId);
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
    if (s.hasChanges) return '有異動';
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
    this.selectedSession.set(session);
    this.showDetail.set(true);
    this.sessionChanges.set([]);
    this.loadingChanges.set(true);
    this.sessionsService.getChanges(session.id).subscribe({
      next: (res) => {
        this.sessionChanges.set(res.data);
        this.loadingChanges.set(false);
      },
      error: () => {
        this.loadingChanges.set(false);
      },
    });
  }

  protected closeDetail(): void {
    this.showDetail.set(false);
    this.selectedSession.set(null);
  }

  protected changeTypeLabel(type: ScheduleChange['changeType']): string {
    const map: Record<ScheduleChange['changeType'], string> = {
      cancellation: '停課',
      substitute: '代課',
      reschedule: '調課',
    };
    return map[type];
  }

  protected changeTypeSeverity(
    type: ScheduleChange['changeType'],
  ): 'secondary' | 'warn' | 'info' {
    const map: Record<ScheduleChange['changeType'], 'secondary' | 'warn' | 'info'> = {
      cancellation: 'secondary',
      substitute: 'warn',
      reschedule: 'info',
    };
    return map[type];
  }

  // ── Cancel ─────────────────────────────────────────────────────────────
  protected openCancel(): void {
    this.cancelReason = '';
    this.showCancelDialog.set(true);
  }

  protected submitCancel(): void {
    const session = this.selectedSession();
    if (!session) return;
    this.cancelLoading.set(true);
    const reason = this.cancelReason.trim() || undefined;
    this.sessionsService.cancel(session.id, reason).subscribe({
      next: () => {
        this.cancelLoading.set(false);
        this.showCancelDialog.set(false);
        this.showDetail.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '停課成功',
          detail: '課堂已標記為停課',
        });
        this.loadSessions();
      },
      error: () => {
        this.cancelLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '操作失敗',
          detail: '請稍後再試',
        });
      },
    });
  }

  // ── Substitute ─────────────────────────────────────────────────────────
  protected openSubstitute(): void {
    this.substituteTeacherId = null;
    this.substituteReason = '';
    this.showSubstituteDialog.set(true);
  }

  protected submitSubstitute(): void {
    const session = this.selectedSession();
    const teacherId = this.substituteTeacherId;
    if (!session || !teacherId) return;
    this.substituteLoading.set(true);
    const reason = this.substituteReason.trim() || undefined;
    this.sessionsService.substitute(session.id, teacherId, reason).subscribe({
      next: () => {
        this.substituteLoading.set(false);
        this.showSubstituteDialog.set(false);
        this.showDetail.set(false);
        this.messageService.add({
          severity: 'success',
          summary: '代課成功',
          detail: '代課安排已記錄',
        });
        this.loadSessions();
      },
      error: () => {
        this.substituteLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '操作失敗',
          detail: '請稍後再試',
        });
      },
    });
  }

  // ── Reschedule ─────────────────────────────────────────────────────────
  protected openReschedule(): void {
    this.rescheduleDate = null;
    this.rescheduleStartTime = '';
    this.rescheduleEndTime = '';
    this.rescheduleReason = '';
    this.showRescheduleDialog.set(true);
  }

  protected submitReschedule(): void {
    const session = this.selectedSession();
    const date = this.rescheduleDate;
    const start = this.rescheduleStartTime.trim();
    const end = this.rescheduleEndTime.trim();
    if (!session || !date || !start || !end) return;
    this.rescheduleLoading.set(true);
    const reason = this.rescheduleReason.trim() || undefined;
    this.sessionsService
      .reschedule(session.id, format(date, 'yyyy-MM-dd'), start, end, reason)
      .subscribe({
        next: () => {
          this.rescheduleLoading.set(false);
          this.showRescheduleDialog.set(false);
          this.showDetail.set(false);
          this.messageService.add({
            severity: 'success',
            summary: '調課成功',
            detail: '調課安排已記錄',
          });
          this.loadSessions();
        },
        error: () => {
          this.rescheduleLoading.set(false);
          this.messageService.add({
            severity: 'error',
            summary: '操作失敗',
            detail: '請稍後再試',
          });
        },
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
      next: (res) => this.campuses.set(res.data),
    });
    this.coursesService.list({ isActive: true, pageSize: 200 }).subscribe({
      next: (res) => this.courses.set(res.data),
    });
    this.staffService.list({ isActive: true, pageSize: 200 }).subscribe({
      next: (res) => this.staff.set(res.data),
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
        campusId: this.selectedCampusId ?? undefined,
        courseId: this.selectedCourseId ?? undefined,
        teacherId: this.selectedTeacherId ?? undefined,
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
