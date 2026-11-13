import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { format, parse } from 'date-fns';
import { firstValueFrom } from 'rxjs';

import { type Session, SessionsService } from '@core/sessions.service';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import { extractErrorMessage } from '@shared/utils/api-error.util';

/**
 * 關窗時回給課表的結果。`linked: false`＝課加開了、但沒連上補課（第二支失敗），課表要提醒去補指定。
 */
export interface AddMakeupResult {
  date: string;
  linked: boolean;
}

const md = (iso: string) => format(parse(iso, 'yyyy-MM-dd', new Date()), 'M/d');

/**
 * 停課那堂「加開一堂補課」（#1314 S7，A6 schedule 單堂 ⋯；設計經計畫席 11-13 gate）。
 *
 * 兩支 API、不是交易：先 `POST /sessions` 加開，成功再 `PATCH /{新 id}/makeup` 指定補這堂。
 * 第一支失敗＝什麼都沒建，錯誤留在對話框；第二支失敗＝課已加開，不自動刪（使用者可能已看到它），
 * 關窗回 `linked: false` 由課表說明怎麼補指定。
 */
@Component({
  selector: 'app-session-add-makeup-dialog',
  imports: [
    DialogFrameComponent,
    ReactiveFormsModule,
    DatePickerModule,
    TextareaModule,
    InlineNoticeComponent,
  ],
  templateUrl: './session-add-makeup-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionAddMakeupDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly sessions = inject(SessionsService);
  private readonly fb = inject(FormBuilder);

  protected readonly cancelled = this.config.data.session as Session;
  protected readonly isSubmitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly minDate = new Date();
  /** 「補 10/2 18:00 數學 A 的停課」 */
  protected readonly target = `補 ${md(this.cancelled.sessionDate)} ${this.cancelled.startTime.slice(0, 5)} ${this.cancelled.className} 的停課`;

  protected readonly form = this.fb.group({
    date: [<Date | null>null, Validators.required],
    start: [parse(this.cancelled.startTime.slice(0, 5), 'HH:mm', new Date()), Validators.required],
    end: [parse(this.cancelled.endTime.slice(0, 5), 'HH:mm', new Date()), Validators.required],
    /** 原老師或未指派（停課那堂沒老師時只有未指派） */
    keepTeacher: [this.cancelled.teacherId !== null],
    reason: [`補 ${md(this.cancelled.sessionDate)} 停課`],
  });

  protected closeDialog(): void {
    this.ref.close();
  }

  protected async submit(): Promise<void> {
    // 送出中擋重送（同 #2479）：送出鈕 disabled 擋得住滑鼠，擋不住 Enter 再送一次表單
    if (this.isSubmitting()) return;
    this.submitError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const startTime = format(v.start!, 'HH:mm');
    const endTime = format(v.end!, 'HH:mm');
    if (startTime >= endTime) {
      this.submitError.set('開始時間需早於結束時間');
      return;
    }
    const sessionDate = format(v.date!, 'yyyy-MM-dd');
    this.isSubmitting.set(true);

    let created: Session;
    try {
      created = (
        await firstValueFrom(
          this.sessions.create({
            classId: this.cancelled.classId,
            sessionDate,
            startTime,
            endTime,
            teacherId: v.keepTeacher ? this.cancelled.teacherId : null,
            reason: v.reason?.trim() || undefined,
          }),
        )
      ).data;
    } catch (err) {
      this.submitError.set(extractErrorMessage(err, '加開失敗，請稍後再試'));
      this.isSubmitting.set(false);
      return;
    }

    try {
      await firstValueFrom(this.sessions.setMakeup(created.id, this.cancelled.id));
      this.ref.close({ date: sessionDate, linked: true } satisfies AddMakeupResult);
    } catch {
      this.ref.close({ date: sessionDate, linked: false } satisfies AddMakeupResult);
    }
  }
}
