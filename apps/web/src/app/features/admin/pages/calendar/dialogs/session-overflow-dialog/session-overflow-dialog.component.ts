import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef, DialogService } from 'primeng/dynamicdialog';
import { Session } from '@core/sessions.service';
import { SessionDetailDialogComponent } from '../session-detail-dialog/session-detail-dialog.component';
import { OverlayContainerService } from '@core/overlay-container.service';

@Component({
  selector: 'app-session-overflow-dialog',
  imports: [ButtonModule],
  templateUrl: './session-overflow-dialog.component.html',
  styleUrl: './session-overflow-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionOverflowDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainer = inject(OverlayContainerService);

  readonly startTime = signal<string>('');
  readonly sessions = signal<Session[]>([]);

  ngOnInit() {
    if (this.config.data) {
      this.startTime.set(this.config.data.startTime || '');
      this.sessions.set(this.config.data.sessions || []);
    }
  }

  protected openDetail(session: Session): void {
    // Note: We don't close the overflow dialog when opening the detail dialog
    // so they can go back to the overflow dialog easily
    this.dialogService.open(SessionDetailDialogComponent, {
      header: '課程詳情',
      width: '400px',
      data: { session },
    });
  }

  protected closeDialog(): void {
    this.ref.close();
  }
}
