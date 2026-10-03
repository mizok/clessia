import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { DailyCheckinsService, type DailyCheckinConfirmation } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { checkinFailure, checkinView, type CheckinFailure } from './checkin-view';

/** 結果畫面停多久自動回到掃描（設計稿 b6：櫃台前常常排隊） */
export const RESULT_SECONDS = 8;

/**
 * 到班打卡站（#1127）。分校門口的機台（`/kiosk/checkin`）與行政人員（`/admin/checkin`）共用。
 *
 * 分校**不送** —— 機台由後端取帳號綁的那一個；行政不指名分校時照既有規則寫。
 * 日期一律台北今天（機台不補登，後端也擋）。
 *
 * 輸入是**卡號＝學生 id**（相機掃碼與學生 QR 卡另開一單；掃碼器讀到的字串會打進同一個欄位）。
 * 結果與失敗的文案在 `checkin-view.ts`（設計稿 b6 的 ok／again／noclass／leave／per-session／invalid／offline）。
 */
@Component({
  selector: 'app-checkin-station',
  imports: [FormsModule, ButtonModule, InputTextModule],
  templateUrl: './checkin-station.component.html',
})
export class CheckinStationComponent {
  private readonly checkins = inject(DailyCheckinsService);
  private readonly clock = inject(SystemClockService);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly code = signal('');
  protected readonly submitting = signal(false);
  private readonly result = signal<DailyCheckinConfirmation | null>(null);
  protected readonly view = computed(() => {
    const r = this.result();
    return r ? checkinView(r) : null;
  });
  protected readonly failure = signal<CheckinFailure | null>(null);
  protected readonly secondsLeft = signal(0);
  /** 離線重試用：同一張卡再送一次 */
  private lastCode = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  protected submit(code = this.code()): void {
    const studentId = code.trim();
    if (!studentId || this.submitting()) return;

    this.lastCode = studentId;
    this.stopTimer();
    this.submitting.set(true);
    this.failure.set(null);
    this.result.set(null);
    this.checkins.checkIn({ studentId, checkinDate: this.clock.todayTaipei() }).subscribe({
      next: (confirmation) => {
        this.result.set(confirmation);
        this.code.set('');
        this.submitting.set(false);
        this.startTimer();
      },
      error: (err: unknown) => {
        this.failure.set(checkinFailure(err));
        this.code.set('');
        this.submitting.set(false);
        this.startTimer();
      },
    });
  }

  protected retry(): void {
    this.submit(this.lastCode);
  }

  /** 「下一位」或倒數結束：清掉結果、游標回到卡號欄（掃碼器直接打進來） */
  protected next(): void {
    this.stopTimer();
    this.result.set(null);
    this.failure.set(null);
    this.codeInput()?.nativeElement.focus();
  }

  private startTimer(): void {
    this.secondsLeft.set(RESULT_SECONDS);
    this.timer = setInterval(() => {
      const left = this.secondsLeft() - 1;
      this.secondsLeft.set(left);
      if (left <= 0) this.next();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
