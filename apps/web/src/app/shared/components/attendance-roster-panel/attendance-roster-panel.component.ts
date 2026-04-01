import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AttendanceService, AttendanceRoster, RosterStudent } from '@core/attendance.service';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { GRADE_LEVEL_LABELS } from '@core/students.service';

export interface RosterPanelSession {
  eventId: string;
  className: string;
  eventDate: string;
}

@Component({
  selector: 'app-attendance-roster-panel',
  standalone: true,
  imports: [ButtonModule, TagModule, ProgressSpinnerModule],
  templateUrl: './attendance-roster-panel.component.html',
  styleUrl: './attendance-roster-panel.component.scss',
})
export class AttendanceRosterPanelComponent implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly messageService = inject(MessageService);

  readonly session = input.required<RosterPanelSession>();
  readonly closed = output<void>();
  readonly saved = output<{ eventId: string; takenAt: string }>();

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly roster = signal<AttendanceRoster | null>(null);

  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());

  ngOnInit(): void {
    this.loadRoster();
  }

  private loadRoster(): void {
    this.loading.set(true);
    this.attendanceService.roster(this.session().eventId).subscribe({
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
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '無法載入點名名單' });
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

    this.attendanceService.batchUpdate({ eventId: this.session().eventId, updates }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: '已儲存', detail: '點名完成' });
        this.saved.emit({ eventId: this.session().eventId, takenAt: res.takenAt });
        this.closed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '儲存失敗，請稍後再試' });
      },
    });
  }

  protected close(): void {
    this.closed.emit();
  }
}
