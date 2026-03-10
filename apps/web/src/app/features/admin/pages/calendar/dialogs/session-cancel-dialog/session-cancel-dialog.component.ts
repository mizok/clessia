import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import type { Session } from '@core/sessions.service';
import { SessionsService } from '@core/sessions.service';

@Component({
  selector: 'app-session-cancel-dialog',
  imports: [ReactiveFormsModule, ButtonModule, TextareaModule],
  templateUrl: './session-cancel-dialog.component.html',
  styleUrl: './session-cancel-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionCancelDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly sessionsService = inject(SessionsService);
  private readonly fb = inject(FormBuilder);

  readonly session = signal<Session | null>(null);
  readonly isSubmitting = signal(false);

  readonly form = this.fb.group({
    reason: [''],
  });

  ngOnInit() {
    if (this.config.data?.session) {
      this.session.set(this.config.data.session);
    }
  }

  protected closeDialog(): void {
    this.ref.close();
  }

  protected submit(): void {
    const s = this.session();
    if (!s) return;

    this.isSubmitting.set(true);
    const reason = this.form.value.reason || undefined;

    this.sessionsService.cancel(s.id, reason).subscribe({
      next: () => {
        this.ref.close({ result: 'refresh', session: s });
      },
      error: () => {
        this.isSubmitting.set(false);
      },
    });
  }
}
