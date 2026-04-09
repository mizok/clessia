import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap, throwError } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import {
  AttendanceService,
  type AttendanceRoster,
  type EventSessionSummary,
  type RosterStudent,
} from '@core/attendance.service';
import { type Session } from '@core/sessions.service';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import {
  InlineNoticeComponent,
  type InlineNoticeSeverity,
} from '@shared/components/inline-notice/inline-notice.component';

@Component({
  selector: 'app-session-attendance-dialog',
  standalone: true,
  imports: [DatePipe, ButtonModule, ProgressSpinnerModule, TagModule, InlineNoticeComponent],
  templateUrl: './session-attendance-dialog.component.html',
  styleUrl: './session-attendance-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionAttendanceDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly attendanceService = inject(AttendanceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly session = signal<Session | null>(null);
  protected readonly sessionSummary = signal<EventSessionSummary | null>(null);
  protected readonly roster = signal<AttendanceRoster | null>(null);
  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly notice = signal<{ severity: InlineNoticeSeverity; detail: string } | null>(null);

  ngOnInit(): void {
    const session = this.config.data?.session as Session | undefined;
    if (!session) {
      this.loading.set(false);
      this.notice.set({ severity: 'error', detail: '找不到課堂資料，請重新開啟視窗。' });
      return;
    }

    this.session.set(session);
    this.attendanceService
      .sessions({
        date: session.sessionDate,
        classIds: [session.classId],
        pageSize: 100,
      })
      .pipe(
        switchMap((res) => {
          const matchedSession = res.data.find(
            (item) =>
              item.classId === session.classId &&
              item.eventDate === session.sessionDate &&
              item.startTime === session.startTime &&
              item.endTime === session.endTime,
          );

          if (!matchedSession) {
            return throwError(() => new Error('EVENT_NOT_FOUND'));
          }

          return this.attendanceService
            .roster(matchedSession.eventId)
            .pipe(map((roster) => ({ summary: matchedSession, roster })));
        }),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, roster }) => {
          this.sessionSummary.set(summary);
          this.roster.set(roster);
          this.syncLocalStatus(roster.students);
          this.notice.set(null);
          this.loading.set(false);
        },
        error: () => {
          this.notice.set({ severity: 'error', detail: '出勤資料載入失敗，請稍後再試。' });
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
    if (!grade) return '未分級';
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }

  protected save(): void {
    const summary = this.sessionSummary();
    const roster = this.roster();
    if (!summary || !roster) {
      return;
    }

    this.saving.set(true);
    const updates = roster.students
      .filter((student) => !this.isOnLeave(student))
      .map((student) => ({
        studentId: student.studentId,
        status: this.getStatus(student.studentId),
      }));

    this.attendanceService
      .batchUpdate({ eventId: summary.eventId, updates })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.notice.set(null);
          const onLeaveCount = roster.students.filter((student) => student.status === 'on_leave').length;
          const presentCount = updates.filter((update) => update.status === 'present').length;
          const absentCount = updates.filter((update) => update.status === 'absent').length;
          this.ref.close({
            eventId: summary.eventId,
            takenAt: res.takenAt,
            presentCount,
            absentCount,
            onLeaveCount,
          });
        },
        error: () => {
          this.saving.set(false);
          this.notice.set({ severity: 'error', detail: '儲存失敗，請稍後再試。' });
        },
      });
  }

  protected close(): void {
    this.ref.close();
  }

  private syncLocalStatus(students: RosterStudent[]): void {
    const map = new Map<string, 'present' | 'absent'>();
    for (const student of students) {
      if (student.status !== 'on_leave') {
        map.set(student.studentId, student.status === 'present' ? 'present' : 'absent');
      }
    }
    this.localStatus.set(map);
  }
}
