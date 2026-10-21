import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { MessageService } from 'primeng/api';

import { LeaveStreaksService, type LeaveStreakDetail } from '@core/leave-streaks.service';
import { taipeiDateString } from '@core/system-clock.service';

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** 2026-10-14 → 10/14（二） */
export function dayLabel(date: string): string {
  const weekday = WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${weekday}）`;
}

/**
 * 學生檔案帳單章裡的「連續請假可不收費」明細卡（#1732，設計稿 §4、§4.1）。
 *
 * **只提醒、不算金額**：餐費列出單價加總（單價就在筆上，是確定的數字）；月繳／期繳只列不算
 * （一口價沒有每天多少，Q7）；堂數制只說扣了幾堂。調帳單、補堂由行政自己做。
 * 未處理的段一張卡＋「標為已處理」；已處理的收成一行、可展開看明細（查帳用），沒有按鈕。
 * 呼叫端只在有 `manage_finance` 時放它（API 也擋）。
 */
@Component({
  selector: 'app-student-leave-streaks',
  imports: [DecimalPipe, NgTemplateOutlet],
  templateUrl: './student-leave-streaks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentLeaveStreaksComponent implements OnInit {
  readonly studentId = input.required<string>();

  private readonly service = inject(LeaveStreaksService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly streaks = signal<LeaveStreakDetail[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly dayLabel = dayLabel;

  ngOnInit(): void {
    this.load();
  }

  // ponytail: 讀取失敗就不畫（這張卡是提醒，不擋帳單章本身）；要提示再加
  protected load(): void {
    this.service
      .forStudent(this.studentId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.streaks.set(res.data),
        error: () => this.streaks.set([]),
      });
  }

  protected key(streak: LeaveStreakDetail): string {
    return `${streak.firstDay}:${streak.lastDay}`;
  }

  protected range(streak: LeaveStreakDetail): string {
    const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    return `${short(streak.firstDay)}–${short(streak.lastDay)}`;
  }

  protected mealTotal(streak: LeaveStreakDetail): number {
    return streak.meals.reduce((sum, m) => sum + m.unitPrice, 0);
  }

  protected invoicedMonths(streak: LeaveStreakDetail): string {
    const months = [
      ...new Set(streak.meals.flatMap((m) => (m.invoicedMonth ? [m.invoicedMonth] : []))),
    ];
    return months.map((m) => `${Number(m.slice(5, 7))} 月`).join('、');
  }

  protected enrollmentNote(e: LeaveStreakDetail['enrollments'][number]): string {
    switch (e.billingMode) {
      case 'monthly':
        return '月繳，這幾天的學費由你決定怎麼調';
      case 'period':
        return '期繳，這幾天的學費由你決定怎麼調';
      case 'session_pack':
        return e.leaveDeductsSession
          ? `堂數制，已扣 ${e.sessionCount} 堂，可補回`
          : '堂數制，請假不扣堂，不用處理';
      default:
        return '沒有設定計費方式';
    }
  }

  protected reviewedLine(streak: LeaveStreakDetail): string {
    const r = streak.review!;
    // reviewedAt 是 UTC 的 timestamptz：直接切字串，台北 00:00–07:59 標的會變成前一天
    const day = taipeiDateString(Date.parse(r.reviewedAt));
    const at = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
    return `已處理：${this.range(streak)}，${r.reviewerName ? `${r.reviewerName} ` : ''}${at}`;
  }

  protected markReviewed(streak: LeaveStreakDetail): void {
    const studentId = this.studentId();
    this.busy.set(this.key(streak));
    this.service
      .markReviewed(studentId, { firstDay: streak.firstDay, lastDay: streak.lastDay })
      .subscribe({
        next: (res) => {
          this.busy.set(null);
          this.load();
          this.messageService.add({
            severity: 'success',
            summary: '已標為已處理',
            data: {
              undo: () =>
                this.service.undoReview(studentId, res.data.id).subscribe({
                  next: () => this.load(),
                  error: () =>
                    this.messageService.add({ severity: 'error', summary: '復原失敗，請再試一次' }),
                }),
            },
          });
        },
        error: (err: unknown) => {
          this.busy.set(null);
          // 409：這段在別處被改了（延長、銷假）或已經有人標過 —— 重抓現況
          const conflict = err instanceof HttpErrorResponse && err.status === 409;
          this.messageService.add({
            severity: 'error',
            summary: conflict ? '這段請假已經變了' : '標記失敗',
            detail: conflict ? '已重新整理，請再看一次' : '請稍後再試',
          });
          if (conflict) this.load();
        },
      });
  }
}
