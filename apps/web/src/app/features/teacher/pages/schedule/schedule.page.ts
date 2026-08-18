import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
  isToday,
  isPast,
  parseISO,
  differenceInDays,
} from 'date-fns';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  AttendanceRosterPanelComponent,
  type RosterPanelSession,
} from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [DatePipe, ButtonModule, DynamicDialogModule, TagModule],
  providers: [DialogService],
  templateUrl: './schedule.page.html',
  styleUrl: './schedule.page.scss',
})
export class SchedulePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly currentWeekStart = signal<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  protected readonly weekLabel = computed(() => {
    const start = this.currentWeekStart();
    const end = endOfWeek(start, { weekStartsOn: 1 });
    return `${format(start, 'yyyy年M月d日')} – ${format(end, 'M月d日')}`;
  });

  protected readonly weekDays = computed(() => {
    const start = this.currentWeekStart();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return {
        date,
        label: `週${WEEKDAY_LABELS[date.getDay()]}`,
        dateStr: format(date, 'yyyy-MM-dd'),
      };
    });
  });

  protected readonly sessionsByDay = computed(() => {
    const map = new Map<string, EventSessionSummary[]>();
    for (const day of this.weekDays()) map.set(day.dateStr, []);
    for (const s of this.sessions()) {
      const list = map.get(s.eventDate);
      if (list) list.push(s);
    }
    return map;
  });

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => this.orgSettingsService.settings.set(s),
    });
    this.loadSessions();
  }

  protected prevWeek(): void {
    this.currentWeekStart.update((d) => subWeeks(d, 1));
    this.loadSessions();
  }

  protected nextWeek(): void {
    this.currentWeekStart.update((d) => addWeeks(d, 1));
    this.loadSessions();
  }

  protected loadSessions(): void {
    this.loading.set(true);
    const start = this.currentWeekStart();
    const end = endOfWeek(start, { weekStartsOn: 1 });
    // 不必傳 teacherId：後端看角色強制套用老師自己的 id（attendance/teacher-scope.ts）。
    // 由前端傳的話，直接打 API 的人就能指定別人 —— 前端隱藏不構成授權（c1）。
    this.attendanceService
      .sessions({
        dateFrom: format(start, 'yyyy-MM-dd'),
        dateTo: format(end, 'yyyy-MM-dd'),
      })
      .subscribe({
        next: (response) => {
          this.sessions.set(response.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected isTeacherLed(): boolean {
    return (this.orgSettingsService.settings()?.attendanceResponsible ?? 'admin') === 'teacher';
  }

  protected isRetroactiveLocked(session: EventSessionSummary): boolean {
    if (!this.isTeacherLed()) return false;
    const days = this.orgSettingsService.settings()?.attendanceRetroactiveDays ?? 0;
    if (days === 0) return false;
    return differenceInDays(new Date(), parseISO(session.eventDate)) > days;
  }

  protected isFuture(session: EventSessionSummary): boolean {
    return !isPast(parseISO(session.eventDate));
  }

  protected isToday(dateStr: string): boolean {
    return isToday(parseISO(dateStr));
  }

  protected openPanel(session: EventSessionSummary): void {
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
        if (result) {
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
      },
    );
  }
}
