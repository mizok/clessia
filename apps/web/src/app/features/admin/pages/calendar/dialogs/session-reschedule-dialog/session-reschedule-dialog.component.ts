import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Session, SessionsService } from '@core/sessions.service';
import { format } from 'date-fns';

@Component({
  selector: 'app-session-reschedule-dialog',
  imports: [ReactiveFormsModule, ButtonModule, TextareaModule, DatePickerModule],
  templateUrl: './session-reschedule-dialog.component.html',
  styleUrl: './session-reschedule-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionRescheduleDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly sessionsService = inject(SessionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly session = signal<Session | null>(null);
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly minDate = new Date();

  readonly targetDateSessions = signal<Array<{
    courseName: string;
    className: string;
    startTime: string;
    endTime: string;
    teacherName: string | null;
  }>>([]);
  readonly loadingTargetDate = signal(false);

  readonly form = this.fb.group({
    newSessionDate: [<Date | null>null, Validators.required],
    newStartTime: [<Date | null>null, Validators.required],
    newEndTime: [<Date | null>null, Validators.required],
    reason: [''],
  });

  ngOnInit() {
    if (this.config.data?.session) {
      this.session.set(this.config.data.session);
    }

    this.form.get('newSessionDate')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(date => {
        if (!date) { this.targetDateSessions.set([]); return; }
        this.loadTargetDateSessions(date);
      });
  }

  private loadTargetDateSessions(date: Date): void {
    const s = this.session();
    if (!s) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    this.loadingTargetDate.set(true);
    this.sessionsService.list({ from: dateStr, to: dateStr, campusId: s.campusId })
      .subscribe({
        next: res => {
          this.targetDateSessions.set(
            res.data
              .filter(session => session.status === 'scheduled' && session.id !== s.id)
              .map(session => ({
                courseName: session.courseName,
                className: session.className,
                startTime: session.startTime,
                endTime: session.endTime,
                teacherName: session.teacherName,
              }))
          );
          this.loadingTargetDate.set(false);
        },
        error: () => this.loadingTargetDate.set(false),
      });
  }

  protected closeDialog(): void {
    this.ref.close();
  }

  protected submit(): void {
    this.submitError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const s = this.session();
    if (!s) return;

    const formValue = this.form.value;

    const formattedDate = format(formValue.newSessionDate!, 'yyyy-MM-dd');
    const formattedStartTime = format(formValue.newStartTime!, 'HH:mm');
    const formattedEndTime = format(formValue.newEndTime!, 'HH:mm');
    if (formattedStartTime >= formattedEndTime) {
      this.submitError.set('開始時間需早於結束時間');
      return;
    }
    this.isSubmitting.set(true);

    this.sessionsService
      .reschedule(
        s.id,
        formattedDate,
        formattedStartTime,
        formattedEndTime,
        formValue.reason || undefined,
      )
      .subscribe({
        next: () => {
          this.ref.close('refresh');
        },
        error: (err: { error?: { error?: string; message?: string } }) => {
          this.submitError.set(err.error?.error ?? err.error?.message ?? '調課失敗，請稍後再試');
          this.isSubmitting.set(false);
        },
      });
  }
}
