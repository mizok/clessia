import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DynamicDialogConfig, DynamicDialogRef, DialogService } from 'primeng/dynamicdialog';
import { Session, ScheduleChange, SessionsService } from '@core/sessions.service';
import { OverlayContainerService } from '@core/overlay-container.service';
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
  providers: [DialogService, MessageService],
})
export class SessionDetailDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainer = inject(OverlayContainerService);
  private readonly sessionsService = inject(SessionsService);

  readonly session = signal<Session | null>(null);
  readonly sessionChanges = signal<ScheduleChange[]>([]);
  readonly loadingChanges = signal(false);

  // Status computation logic moved from calendar.page
  readonly statusLabel = computed(() => {
    const s = this.session();
    if (!s) return '';
    if (s.status === 'cancelled') return '已停課';
    if (s.status === 'completed') return '已完成';
    return '已排課';
  });

  readonly statusSeverity = computed(() => {
    const s = this.session();
    if (!s) return 'info';
    if (s.status === 'cancelled') return 'secondary';
    if (s.status === 'completed') return 'success';
    return 'info';
  });

  readonly adjustmentLabel = computed(() => {
    const s = this.session();
    if (!s) return '';
    return s.hasChanges ? '有異動' : '無異動';
  });

  readonly adjustmentSeverity = computed(() => {
    const s = this.session();
    if (!s) return 'secondary';
    return s.hasChanges ? 'warn' : 'secondary';
  });

  readonly canOperate = computed(() => {
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
      cancel: '停課',
      substitute: '代課',
      reschedule: '調課',
    };
    return map[type] || type;
  }

  protected changeTypeSeverity(
    type: string,
  ): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' {
    const map: Record<string, 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast'> = {
      cancel: 'danger',
      substitute: 'warn',
      reschedule: 'info',
    };
    return map[type] || 'info';
  }

  protected openCancel(): void {
    const s = this.session();
    if (!s) return;
    const cancelRef = this.dialogService.open(SessionCancelDialogComponent, {
      header: '停課',
      width: '400px',
      data: { session: s },
      styleClass: 'cal-dialog',
    });
    cancelRef?.onClose.subscribe((result?: { result: string; session: Session }) => {
      if (result?.result === 'refresh') {
        this.ref.close('refresh');
        this.messageService.add({
          severity: 'success',
          summary: '已停課',
          detail: '如需安排補課，請至行事曆清單視圖新增調課',
          life: 6000,
        });
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
      styleClass: 'cal-dialog',
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
      styleClass: 'cal-dialog',
    });
  }

  protected closeDialog(): void {
    this.ref.close();
  }
}
