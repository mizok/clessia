import { Component, OnInit, inject, signal, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { format } from 'date-fns';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  AttendanceRosterPanelComponent,
  type RosterPanelSession,
} from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [FormsModule, ButtonModule, DatePickerModule, DynamicDialogModule, ToastModule],
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

  protected readonly selectedDate = signal<Date>(new Date());
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => this.orgSettingsService.settings.set(s),
    });
    this.loadSessions();
  }

  protected onDateChange(date: Date): void {
    this.selectedDate.set(date);
    this.loadSessions();
  }

  protected loadSessions(): void {
    this.loading.set(true);
    const date = format(this.selectedDate(), 'yyyy-MM-dd');
    this.attendanceService.sessions({ date }).subscribe({
      next: (data) => {
        this.sessions.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
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
      (result?: { eventId: string; takenAt: string; presentCount: number; absentCount: number; onLeaveCount: number }) => {
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

  protected isAdminLed(): boolean {
    return (this.orgSettingsService.settings()?.attendanceResponsible ?? 'admin') === 'admin';
  }
}
