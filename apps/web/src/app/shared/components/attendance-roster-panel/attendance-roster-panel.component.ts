import { Component, OnInit, inject, signal } from '@angular/core';
import {
  AttendanceService,
  type AttendanceRoster,
  type RosterStudent,
} from '@core/attendance.service';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import {
  InlineNoticeComponent,
  type InlineNoticeSeverity,
} from '@shared/components/inline-notice/inline-notice.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';

export interface RosterPanelSession {
  eventId: string;
  className: string;
  eventDate: string;
}

@Component({
  selector: 'app-attendance-roster-panel',
  standalone: true,
  imports: [DataChipComponent, ButtonModule, ProgressSpinnerModule, InlineNoticeComponent],
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
  /**
   * 只放**老師實際標過**的人。沒有出現在這個 Map 裡就是「還沒標」。
   *
   * 原本這裡把沒有紀錄的人預設成 `absent`，而「缺席」在畫面上是實心（選中態）——
   * 面板一打開，全班看起來已經被標成缺席，直接按儲存就是全班記缺席。
   * 那是把「我還沒點」跟「我點了，他沒來」混成同一件事，而預設倒向了指控。
   */
  protected readonly localStatus = signal<Map<string, 'present' | 'absent'>>(new Map());
  protected readonly notice = signal<{ severity: InlineNoticeSeverity; detail: string } | null>(
    null,
  );

  ngOnInit(): void {
    this.loadRoster();
  }

  private loadRoster(): void {
    this.loading.set(true);
    this.attendanceService.roster(this.session.eventId).subscribe({
      next: (data) => {
        this.roster.set(data);
        // 只帶出**已經有紀錄**的狀態；沒紀錄的留白，不要幫他決定
        const map = new Map<string, 'present' | 'absent'>();
        for (const s of data.students) {
          if (s.status && s.status !== 'on_leave') {
            map.set(s.studentId, s.status);
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

  /** `null` = 還沒標。呼叫端要能分辨「沒標」與「標了缺席」 */
  protected getStatus(studentId: string): 'present' | 'absent' | null {
    return this.localStatus().get(studentId) ?? null;
  }

  /**
   * 一鍵全到。最常見的情況是全班都來了，而逐一點過去是 N 次點擊 ——
   * 沒有這顆的話，最常見的情況剛好是最貴的操作。
   *
   * **請假的人不動** —— 那是行政登記的狀態，一鍵到課不該把它蓋掉。
   */
  protected markAllPresent(): void {
    const roster = this.roster();
    if (!roster) return;
    const map = new Map(this.localStatus());
    for (const s of roster.students) {
      if (!this.isOnLeave(s)) map.set(s.studentId, 'present');
    }
    this.localStatus.set(map);
  }

  /** 標過的人數 —— 儲存鈕靠它決定能不能按 */
  protected markedCount(): number {
    return this.localStatus().size;
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

    // 只送標過的人。未標記的不寫入 —— 「還沒點到他」不該變成一筆缺席紀錄
    const updates = roster.students
      .filter((s) => !this.isOnLeave(s))
      .map((s) => ({ studentId: s.studentId, status: this.getStatus(s.studentId) }))
      .filter(
        (u): u is { studentId: string; status: 'present' | 'absent' } => u.status !== null,
      );

    if (updates.length === 0) {
      this.saving.set(false);
      this.notice.set({ severity: 'warning', detail: '還沒標記任何學生' });
      return;
    }

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
