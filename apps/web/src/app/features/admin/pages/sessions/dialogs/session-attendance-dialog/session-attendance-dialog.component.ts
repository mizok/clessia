import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap, throwError } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
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
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

@Component({
  selector: 'app-session-attendance-dialog',
  standalone: true,
  imports: [
    StatusDotComponent,
    DataChipComponent,
    DatePipe,
    ButtonModule,
    ProgressSpinnerModule,
    InlineNoticeComponent,
  ],
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
  /**
   * **只放已經點過的人。** 沒有 key 代表「還沒點」——那是一個真實的第三態
   * （後端的 `RosterStudent.status` 本來就有 `null`），不是 `absent`。
   */
  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly notice = signal<{ severity: InlineNoticeSeverity; detail: string } | null>(
    null,
  );

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

          // eventId 是 null 代表停課、後端沒補建事件 —— 對呼叫端來說跟「找不到」同一種結果
          if (!matchedSession || matchedSession.eventId === null) {
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

  /** `null` = 還沒點。**不要把它讀成 `absent`** —— 缺席是一個會通知家長的宣告 */
  protected getStatus(studentId: string): 'present' | 'absent' | null {
    return this.localStatus().get(studentId) ?? null;
  }

  /**
   * 還沒點名的人數。**大於 0 就不給存** —— 後端只要收到任何一次 batch 就會蓋上
   * `attendance_taken_at`（`routes/attendance.ts` 的 PATCH /batch），那堂課從此算
   * 「已點名」。半途存下去的話，沒點到的人不會有紀錄、也**不會再出現在漏點名清單裡**，
   * 那是比預選缺席更難發現的沉默。
   */
  protected readonly pendingCount = computed(() => {
    const roster = this.roster();
    if (!roster) return 0;
    const done = this.localStatus();
    return roster.students.filter((s) => !this.isOnLeave(s) && !done.has(s.studentId)).length;
  });

  /** 常見情況是全到 —— 一鍵之後只改少數幾個，比逐一點快，而且是**主動宣告**不是預設值 */
  protected markAllPresent(): void {
    const roster = this.roster();
    if (!roster) return;
    const map = new Map(this.localStatus());
    for (const student of roster.students) {
      if (!this.isOnLeave(student)) map.set(student.studentId, 'present');
    }
    this.localStatus.set(map);
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
    // eventId 是 null 就沒有可寫入的出勤事件；載入時已擋掉，這裡是型別上的第二道
    if (!summary || !roster || summary.eventId === null) {
      return;
    }

    // 見 pendingCount 的註解：半途儲存會讓沒點到的人靜靜消失在漏點名清單外
    if (this.pendingCount() > 0) {
      this.notice.set({
        severity: 'warning',
        detail: `還有 ${this.pendingCount()} 位學生沒點 —— 存檔會把整堂課標記為已點名，沒點到的人不會再出現在待辦裡。`,
      });
      return;
    }

    this.saving.set(true);
    const updates = roster.students
      .filter((student) => !this.isOnLeave(student))
      // pendingCount 的守衛保證這裡不會有 null（每個非請假的學生都點過了）
      .map((student) => ({
        studentId: student.studentId,
        status: this.getStatus(student.studentId) ?? 'absent',
      }));

    this.attendanceService
      .batchUpdate({ eventId: summary.eventId, updates })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.notice.set(null);
          const onLeaveCount = roster.students.filter(
            (student) => student.status === 'on_leave',
          ).length;
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

  /**
   * **只同步已經有紀錄的人。**
   *
   * 舊版寫的是 `student.status === 'present' ? 'present' : 'absent'` —— 那個三元式把
   * `null`（還沒點名）壓成 `'absent'`，於是打開 dialog 時全班預選缺席，一鍵儲存就入庫，
   * **而缺席會通知家長**。UI 把「還不知道」編成了一個具體的壞消息。
   */
  private syncLocalStatus(students: RosterStudent[]): void {
    const map = new Map<string, 'present' | 'absent'>();
    for (const student of students) {
      if (student.status === 'present' || student.status === 'absent') {
        map.set(student.studentId, student.status);
      }
    }
    this.localStatus.set(map);
  }
}
