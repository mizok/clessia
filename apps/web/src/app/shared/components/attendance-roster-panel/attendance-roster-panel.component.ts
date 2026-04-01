import { Component, OnInit, inject, signal } from '@angular/core';
import { AttendanceService, type AttendanceRoster, type RosterStudent } from '@core/attendance.service';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import { InlineNoticeComponent, type InlineNoticeSeverity } from '@shared/components/inline-notice/inline-notice.component';

export interface RosterPanelSession {
  eventId: string;
  className: string;
  eventDate: string;
}

@Component({
  selector: 'app-attendance-roster-panel',
  standalone: true,
  imports: [ButtonModule, TagModule, ProgressSpinnerModule, InlineNoticeComponent],
  templateUrl: './attendance-roster-panel.component.html',
  styleUrl: './attendance-roster-panel.component.scss',
})
export class AttendanceRosterPanelComponent implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly session = this.config.data as RosterPanelSession;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly roster = signal<AttendanceRoster | null>(null);
  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());
  protected readonly notice = signal<{ severity: InlineNoticeSeverity; detail: string } | null>(null);

  ngOnInit(): void {
    this.loadRoster();
  }

  private loadRoster(): void {
    this.loading.set(true);
    this.attendanceService.roster(this.session.eventId).subscribe({
      next: (data) => {
        this.roster.set(data);
        const map = new Map<string, 'present' | 'absent'>();
        for (const s of data.students) {
          if (s.status !== 'on_leave') {
            map.set(s.studentId, (s.status as 'present' | 'absent') ?? 'absent');
          }
        }
        this.localStatus.set(map);
        this.loading.set(false);
      },
      error: () => {
        this.notice.set({ severity: 'error', detail: '無法載入點名名單' });
        this.loading.set(false);
      },
    });
  }

  protected isOnLeave(student: RosterStudent): boolean {
    return student.status === 'on_leave';
  }

  protected getStatus(studentId: string): 'present' | 'absent' {
    return this.localStatus().get(studentId) ?? 'absent';
  }

  protected setStatus(studentId: string, status: 'present' | 'absent'): void {
    const map = new Map(this.localStatus());
    map.set(studentId, status);
    this.localStatus.set(map);
  }

  protected gradeLabel(grade: string | null): string {
    if (!grade) return '';
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }

  protected save(): void {
    const roster = this.roster();
    if (!roster) return;
    this.saving.set(true);

    const updates = roster.students
      .filter((s) => !this.isOnLeave(s))
      .map((s) => ({ studentId: s.studentId, status: this.getStatus(s.studentId) }));

    this.attendanceService.batchUpdate({ eventId: this.session.eventId, updates }).subscribe({
      next: (res) => {
        this.saving.set(false);
        const onLeaveCount = roster.students.filter((s) => s.status === 'on_leave').length;
        const presentCount = updates.filter((u) => u.status === 'present').length;
        const absentCount = updates.filter((u) => u.status === 'absent').length;
        this.ref.close({
          eventId: this.session.eventId,
          takenAt: res.takenAt,
          presentCount,
          absentCount,
          onLeaveCount,
        });
      },
      error: () => {
        this.saving.set(false);
        this.notice.set({ severity: 'error', detail: '儲存失敗，請稍後再試' });
      },
    });
  }

  protected close(): void {
    this.ref.close();
  }
}
