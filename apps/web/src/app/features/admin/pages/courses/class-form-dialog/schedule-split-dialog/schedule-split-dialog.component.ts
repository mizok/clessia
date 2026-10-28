import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';

import {
  ClassesService,
  type Schedule,
  type SplitKeptReason,
  type SplitScheduleInput,
  type SplitScheduleResult,
} from '@core/classes.service';
import { addDaysToDateString, taipeiDateString } from '@core/system-clock.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import { shortDate } from '@shared/utils/schedule-effective.util';

export interface ScheduleSplitDialogData {
  classId: string;
  schedule: Schedule;
  classroomOptions: Array<{ label: string; value: string | null }>;
  /** 能教這班的老師（分校＋科目，同班級表單的篩選）；API 換老師時還會再驗一次（#854） */
  teacherOptions: Array<{ label: string; value: string }>;
}

const WEEKDAY = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

const REASON_LABEL: Record<SplitKeptReason, string> = {
  status: '已上課或已停課',
  attendance: '已點名',
  schedule_change: '有異動紀錄',
  leave: '有人請假',
  makeup: '有補課指著它',
};

/**
 * 「從某日起改時段」（#1100 #22）：舊時段止於前一天、新時段從這天起。
 * **一定先預覽**（API `dryRun`，整段照跑再回滾）才能送出 —— 送出會刪掉沒資料的舊課堂並重產，
 * 有資料的保留，要讓行政在按下去之前就看到哪幾堂要自己處理。改了任何欄位，預覽就作廢。
 * 關閉時回傳送出的結果；取消回 undefined。
 */
@Component({
  selector: 'app-schedule-split-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, InlineNoticeComponent],
  templateUrl: './schedule-split-dialog.component.html',
})
export class ScheduleSplitDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ScheduleSplitDialogData>);
  private readonly classesService = inject(ClassesService);

  protected readonly data = this.config.data as ScheduleSplitDialogData;
  private readonly old = this.data.schedule;
  protected readonly weekdayOptions = WEEKDAY.slice(1).map((label, i) => ({ label, value: i + 1 }));

  /** 不能早於今天（上過的課走異動流程），也要晚於舊時段的起始日；不晚於舊時段的結束日 */
  protected readonly minDate = (() => {
    const today = taipeiDateString(Date.now());
    const afterStart = addDaysToDateString(this.old.effectiveFrom, 1);
    return afterStart > today ? afterStart : today;
  })();
  protected readonly maxDate = this.old.effectiveTo ?? '';

  protected readonly form = signal({
    fromDate: this.minDate,
    weekday: this.old.weekday,
    startTime: this.old.startTime.slice(0, 5),
    endTime: this.old.endTime.slice(0, 5),
    classroomId: this.old.classroomId,
    teacherId: this.old.teacherId,
  });
  protected readonly preview = signal<SplitScheduleResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly oldLabel = `${WEEKDAY[this.old.weekday]} ${this.old.startTime.slice(0, 5)}–${this.old.endTime.slice(0, 5)}`;
  protected readonly oldEndLabel = computed(() => {
    const d = this.form().fromDate;
    return d ? shortDate(addDaysToDateString(d, -1)) : '';
  });

  /**
   * 換老師一律走這裡（#2049 (e)）：有生效日、留下任期。前任卸任後只看得到 X 以前的資料、而且唯讀；
   * 直接改原時段的老師（PUT）只用來更正填錯，會讓前任立刻失去整班。
   */
  protected readonly teacherSelectOptions = [
    { label: '還沒指派', value: null as string | null },
    ...this.data.teacherOptions.map((o) => ({ label: o.label, value: o.value as string | null })),
    // 舊老師不在可選清單裡（例如後來被移出這個分校）也要顯示得出名字，不然看起來像沒有老師
    ...(this.old.teacherId && !this.data.teacherOptions.some((o) => o.value === this.old.teacherId)
      ? [{ label: this.old.teacherName ?? '原任老師', value: this.old.teacherId as string | null }]
      : []),
  ];
  protected readonly teacherChanged = computed(() => this.form().teacherId !== this.old.teacherId);
  protected readonly oldTeacherName = this.old.teacherName ?? '原任老師';

  protected readonly invalid = computed(() => {
    const f = this.form();
    if (!f.fromDate || f.fromDate < this.minDate) return `生效日最早 ${shortDate(this.minDate)}`;
    if (this.maxDate && f.fromDate > this.maxDate) return `生效日最晚 ${shortDate(this.maxDate)}`;
    if (!f.startTime || !f.endTime || f.startTime >= f.endTime) return '開始時間要早於結束時間';
    return null;
  });

  protected update<K extends keyof ReturnType<typeof this.form>>(
    field: K,
    value: ReturnType<typeof this.form>[K],
  ): void {
    this.form.update((f) => ({ ...f, [field]: value }));
    this.preview.set(null);
    this.error.set(null);
  }

  protected keptLine(k: SplitScheduleResult['kept'][number]): string {
    return `${shortDate(k.sessionDate)} ${k.startTime.slice(0, 5)}：${k.reasons.map((r) => REASON_LABEL[r]).join('、')}`;
  }

  protected runPreview(): void {
    this.send(true);
  }

  protected confirm(): void {
    this.send(false);
  }

  protected cancel(): void {
    this.ref.close();
  }

  private send(dryRun: boolean): void {
    if (this.invalid()) return;
    const f = this.form();
    const input: SplitScheduleInput = {
      fromDate: f.fromDate,
      weekday: f.weekday,
      startTime: f.startTime,
      endTime: f.endTime,
      teacherId: f.teacherId,
      classroomId: f.classroomId,
      dryRun,
    };
    this.loading.set(true);
    this.error.set(null);
    this.classesService.splitSchedule(this.data.classId, this.old.id, input).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (dryRun) this.preview.set(res.data);
        else this.ref.close(res.data);
      },
      error: (err) => {
        this.loading.set(false);
        this.preview.set(null);
        this.error.set(err?.error?.error || '改時段失敗，請稍後再試');
      },
    });
  }
}
