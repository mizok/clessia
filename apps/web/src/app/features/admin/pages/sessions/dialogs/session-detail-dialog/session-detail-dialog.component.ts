import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { type Session, type SessionHistoryEntry, SessionsService } from '@core/sessions.service';

@Component({
  selector: 'app-session-detail-dialog',
  imports: [DatePipe, ButtonModule, SkeletonModule, TagModule],
  templateUrl: './session-detail-dialog.component.html',
  styleUrl: './session-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionDetailDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly sessionsService = inject(SessionsService);

  protected readonly session = signal<Session | null>(null);
  protected readonly historyEntries = signal<SessionHistoryEntry[]>([]);
  protected readonly loadingChanges = signal(false);
  protected readonly loadError = signal(false);

  protected readonly statusLabel = computed(() => {
    const s = this.session();
    if (!s) return '';
    if (s.status === 'cancelled') return '已停課';
    if (s.status === 'completed') return '已完成';
    return '已排課';
  });

  protected readonly statusSeverity = computed(() => {
    const s = this.session();
    if (!s) return 'info';
    if (s.status === 'cancelled') return 'secondary';
    if (s.status === 'completed') return 'success';
    return 'info';
  });

  protected readonly contextLine = computed(() => {
    const s = this.session();
    if (!s) return '';

    const teacherLabel = s.assignmentStatus === 'unassigned' ? '未指派' : (s.teacherName ?? '未指派');
    return `${s.sessionDate.slice(5).replace('-', '/')} ${s.startTime}–${s.endTime} ・ ${s.campusName} ・ ${teacherLabel}`;
  });

  ngOnInit() {
    if (this.config.data?.session) {
      this.session.set(this.config.data.session);
    }
    if (this.config.data?.changes) {
      this.historyEntries.set(this.config.data.changes);
    }
    if (this.config.data?.loadingChanges !== undefined) {
      this.loadingChanges.set(this.config.data.loadingChanges);
    }
    this.loadError.set(false);

    const s = this.session();
    if (s && this.loadingChanges()) {
      this.sessionsService.getChanges(s.id).subscribe({
        next: (res: { data: SessionHistoryEntry[] }) => {
          this.historyEntries.set(res.data);
          this.loadError.set(false);
          this.loadingChanges.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loadingChanges.set(false);
        },
      });
    }
  }

  protected changeTypeLabel(type: string): string {
    const map: Record<string, string> = {
      creation: '建立',
      cancellation: '停課',
      substitute: '代課',
      reschedule: '調課',
      uncancel: '取消停課',
    };
    return map[type] || type;
  }

  protected summaryValue(value: string | null | undefined, fallback: string): string {
    return value && value.trim().length > 0 ? value : fallback;
  }

  protected changeSummary(change: SessionHistoryEntry): string {
    if (change.changeType === 'creation') {
      return '課堂建立';
    }

    if (change.changeType === 'substitute') {
      const originalTeacher = this.summaryValue(change.originalTeacherName, '原老師未記錄');
      const substituteTeacher = this.summaryValue(change.substituteTeacherName, '代課老師未記錄');
      return `${originalTeacher} → ${substituteTeacher}`;
    }

    if (change.changeType === 'reschedule') {
      return `${this.formatScheduleSlot(change.originalSessionDate, change.originalStartTime, change.originalEndTime)} -> ${this.formatScheduleSlot(change.newSessionDate, change.newStartTime, change.newEndTime)}`;
    }

    if (change.changeType === 'uncancel') {
      return '課堂已恢復為正常上課狀態';
    }

    return '課堂已標記為停課';
  }

  protected changeReason(change: SessionHistoryEntry): string | null {
    if (change.changeType === 'creation') {
      return null;
    }

    return this.summaryValue(change.reason, '未填寫原因');
  }

  protected changeActorLabel(change: SessionHistoryEntry): string {
    const fallback = change.changeType === 'creation' ? '系統排程' : '系統紀錄';
    const actorName = this.summaryValue(change.createdByName, fallback);
    return change.changeType === 'creation' ? `建立者：${actorName}` : `操作人：${actorName}`;
  }

  protected changeSourceLabel(change: SessionHistoryEntry): string | null {
    if (change.changeType === 'creation') {
      return null;
    }

    return change.operationSource === 'batch' ? '批次操作' : '單堂操作';
  }

  protected changeTypeSeverity(
    type: string,
  ): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' {
    const map: Record<string, 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast'> = {
      creation: 'secondary',
      cancellation: 'danger',
      substitute: 'warn',
      reschedule: 'info',
      uncancel: 'success',
    };
    return map[type] || 'info';
  }

  private formatScheduleSlot(
    sessionDate: string | null,
    startTime: string | null,
    endTime: string | null,
  ): string {
    const normalizedDate = sessionDate ? sessionDate.slice(5).replace('-', '/') : '--/--';
    const normalizedStart = startTime ?? '--:--';
    const normalizedEnd = endTime ?? '--:--';
    return `${normalizedDate} ${normalizedStart} - ${normalizedEnd}`;
  }

  protected closeDialog(): void {
    this.ref.close();
  }
}
