import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DynamicDialogConfig, DynamicDialogRef, DialogService } from 'primeng/dynamicdialog';
import { type Session, type ScheduleChange, SessionsService } from '@core/sessions.service';
import { SessionCancelDialogComponent } from '../session-cancel-dialog/session-cancel-dialog.component';
import { SessionSubstituteDialogComponent } from '../session-substitute-dialog/session-substitute-dialog.component';
import { SessionRescheduleDialogComponent } from '../session-reschedule-dialog/session-reschedule-dialog.component';
import { isPast } from 'date-fns';

@Component({
  selector: 'app-session-detail-dialog',
  imports: [DatePipe, ButtonModule, SkeletonModule, TagModule, TooltipModule],
  templateUrl: './session-detail-dialog.component.html',
  styleUrl: './session-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DialogService],
})
export class SessionDetailDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly dialogService = inject(DialogService);
  private readonly sessionsService = inject(SessionsService);

  protected readonly session = signal<Session | null>(null);
  protected readonly sessionChanges = signal<ScheduleChange[]>([]);
  protected readonly loadingChanges = signal(false);

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

  protected readonly adjustmentLabel = computed(() => {
    const s = this.session();
    if (!s) return '';
    return s.hasChanges ? '有異動' : '無異動';
  });

  protected readonly adjustmentSeverity = computed(() => {
    const s = this.session();
    if (!s) return 'secondary';
    return s.hasChanges ? 'warn' : 'secondary';
  });

  protected readonly canOperate = computed(() => {
    const s = this.session();
    if (!s) return false;
    if (s.status === 'cancelled') return false;
    const sessionDateTime = new Date(`${s.sessionDate}T${s.endTime}`);
    return !isPast(sessionDateTime);
  });

  ngOnInit() {
    if (this.config.data?.session) {
      this.session.set(this.config.data.session);
    }
    if (this.config.data?.changes) {
      this.sessionChanges.set(this.config.data.changes);
    }
    if (this.config.data?.loadingChanges !== undefined) {
      this.loadingChanges.set(this.config.data.loadingChanges);
    }

    const s = this.session();
    if (s && this.loadingChanges()) {
      this.sessionsService.getChanges(s.id).subscribe({
        next: (res: { data: ScheduleChange[] }) => {
          this.sessionChanges.set(res.data);
          this.loadingChanges.set(false);
        },
        error: () => {
          this.loadingChanges.set(false);
        },
      });
    }
  }

  protected changeTypeLabel(type: string): string {
    const map: Record<string, string> = {
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

  protected changeSummary(change: ScheduleChange): string {
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

  protected changeReason(change: ScheduleChange): string {
    return this.summaryValue(change.reason, '未填寫原因');
  }

  protected changeActorLabel(change: ScheduleChange): string {
    return this.summaryValue(change.createdByName, '系統紀錄');
  }

  protected changeSourceLabel(change: ScheduleChange): string {
    return change.operationSource === 'batch' ? '批次操作' : '單堂操作';
  }

  protected changeTypeSeverity(
    type: string,
  ): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' {
    const map: Record<string, 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast'> = {
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

  protected openCancel(): void {
    const s = this.session();
    if (!s) return;
    const cancelRef = this.dialogService.open(SessionCancelDialogComponent, {
      header: '停課',
      width: '400px',
      data: { session: s },
      styleClass: 'session-dialog',
    });
    cancelRef?.onClose.subscribe((result?: { result: string; session: Session }) => {
      if (result?.result === 'refresh') {
        this.ref.close('cancelled');
      }
    });
  }

  protected openSubstitute(): void {
    const s = this.session();
    if (!s) return;
    this.ref.close();
    this.dialogService.open(SessionSubstituteDialogComponent, {
      header: '安排代課',
      width: '400px',
      data: { session: s },
      styleClass: 'session-dialog',
    });
  }

  protected openReschedule(): void {
    const s = this.session();
    if (!s) return;
    this.ref.close();
    this.dialogService.open(SessionRescheduleDialogComponent, {
      header: '調課',
      width: '400px',
      data: { session: s },
      styleClass: 'session-dialog',
    });
  }

  protected closeDialog(): void {
    this.ref.close();
  }
}
