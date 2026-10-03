import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import {
  DailyCheckinsService,
  type DailyCheckinConfirmation,
} from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

/**
 * 到班打卡站（#1127）。分校門口的機台（`/kiosk/checkin`）與行政人員（`/admin/checkin`）共用。
 *
 * 分校**不送** —— 機台由後端取帳號綁的那一個；行政不指名分校時照既有規則寫。
 * 日期一律台北今天（機台不補登，後端也擋）。
 *
 * 輸入是**卡號＝學生 id**（相機掃碼與學生 QR 卡另開一單；掃碼器讀到的字串會打進同一個欄位）。
 */
@Component({
  selector: 'app-checkin-station',
  imports: [FormsModule, ButtonModule, InputTextModule, InlineNoticeComponent],
  templateUrl: './checkin-station.component.html',
})
export class CheckinStationComponent {
  private readonly checkins = inject(DailyCheckinsService);
  private readonly clock = inject(SystemClockService);

  protected readonly code = signal('');
  protected readonly submitting = signal(false);
  protected readonly result = signal<DailyCheckinConfirmation | null>(null);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    const studentId = this.code().trim();
    if (!studentId || this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);
    this.result.set(null);
    this.checkins.checkIn({ studentId, checkinDate: this.clock.todayTaipei() }).subscribe({
      next: (confirmation) => {
        this.result.set(confirmation);
        this.code.set('');
        this.submitting.set(false);
      },
      error: (err: unknown) => {
        this.error.set(checkinErrorMessage(err));
        this.submitting.set(false);
      },
    });
  }

  /** `17:00:00` → `17:00` */
  protected clock5(time: string): string {
    return time.slice(0, 5);
  }
}

/** 機台前面的是學生，訊息要讓他知道下一步（找櫃台），不是錯誤碼 */
export function checkinErrorMessage(err: unknown): string {
  const status = err instanceof HttpErrorResponse ? err.status : 0;
  if (status === 400 || status === 404) return '找不到這張卡，請到櫃台確認';
  if (status === 403) return '這張卡不能在這裡打卡，請到櫃台確認';
  if (status === 401) return '機台已登出，請通知櫃台重新登入';
  return '打卡失敗，請再試一次或到櫃台登記';
}
