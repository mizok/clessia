import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DrawerModule } from 'primeng/drawer';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { format } from 'date-fns';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import {
  AttendanceRosterPanelComponent,
  type RosterPanelSession,
} from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    DrawerModule,
    ToastModule,
    AttendanceRosterPanelComponent,
  ],
  providers: [MessageService],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);

  protected readonly selectedDate = signal<Date>(new Date());
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  protected readonly panelVisible = signal(false);
  protected readonly activeSession = signal<RosterPanelSession | null>(null);

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
    this.activeSession.set({
      eventId: session.eventId,
      className: session.className,
      eventDate: session.eventDate,
    });
    this.panelVisible.set(true);
  }

  protected onPanelSaved(result: { eventId: string; takenAt: string }): void {
    this.sessions.update((list) =>
      list.map((s) => (s.eventId === result.eventId ? { ...s, takenAt: result.takenAt } : s)),
    );
  }

  protected isTaken(session: EventSessionSummary): boolean {
    return session.takenAt !== null;
  }

  protected isAdminLed(): boolean {
    return (this.orgSettingsService.settings()?.attendanceResponsible ?? 'admin') === 'admin';
  }
}
