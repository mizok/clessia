import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { DailyCheckinsService, type DailyCheckinConfirmation } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { checkinFailure, checkinView, type CheckinFailure } from './checkin-view';
import { QR_DECODER_FACTORY, cameraErrorState, type QrDecoder } from './qr-camera';

/** 結果畫面停多久自動回到掃描（設計稿 b6：櫃台前常常排隊） */
export const RESULT_SECONDS = 8;

/** 每 250ms 解一次，不是每個 frame —— 平板整天開著，省電省熱 */
const SCAN_INTERVAL_MS = 250;

type CameraState = 'off' | 'starting' | 'scanning' | 'denied' | 'unavailable';

/**
 * 到班打卡站（#1127）。分校門口的機台（`/kiosk/checkin`）與行政人員（`/admin/checkin`）共用。
 *
 * 分校**不送** —— 機台由後端取帳號綁的那一個；行政不指名分校時照既有規則寫。
 * 日期一律台北今天（機台不補登，後端也擋）。
 *
 * 輸入是**卡號＝學生 id**，三種來源走同一個 `submit`：掃碼槍（鍵盤輸入＋Enter）、手打、相機掃到的 QR。
 * 相機（#1127）：機台 `camera="auto"` 一進頁就開；管理端預設不開、給一顆按鈕（計畫席裁）。
 * 解碼器選型在 `qr-camera.ts`（原生 `BarcodeDetector` 優先、iPad 退 `jsqr`）。
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
  private readonly createDecoder = inject(QR_DECODER_FACTORY);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  /** `auto`：一進頁就開鏡頭（機台）；`manual`：按「開啟相機」才開（管理端） */
  readonly camera = input<'auto' | 'manual'>('manual');
  protected readonly cameraState = signal<CameraState>('off');
  private stream: MediaStream | null = null;
  private decoder: QrDecoder | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private decoding = false;
  /** 同一張卡停在鏡頭前：回到掃描後 8 秒內不重送（後端重掃不覆寫，這是避免畫面閃兩次） */
  private lastScan = { code: '', at: 0 };
  /** 頁面隱藏時關了鏡頭，回來要再開 */
  private resumeOnVisible = false;

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
    const onVisibility = () => this.onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.stopTimer();
      this.stopCamera();
      document.removeEventListener('visibilitychange', onVisibility);
    });
    // `<video>` 要在 DOM 裡才接得上串流
    afterNextRender(() => {
      if (this.camera() === 'auto') void this.startCamera();
    });
  }

  protected async startCamera(): Promise<void> {
    const media = navigator.mediaDevices;
    // 非 HTTPS 時 `mediaDevices` 不存在
    if (!media?.getUserMedia) {
      this.cameraState.set('unavailable');
      return;
    }
    this.cameraState.set('starting');
    try {
      this.stream = await media.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      const video = this.video()!.nativeElement;
      video.srcObject = this.stream;
      await video.play();
      this.decoder ??= await this.createDecoder();
      this.cameraState.set('scanning');
      this.scanTimer = setInterval(() => void this.scanOnce(), SCAN_INTERVAL_MS);
    } catch (err) {
      this.stopCamera();
      this.cameraState.set(cameraErrorState(err));
    }
  }

  /** 解一格。結果／失敗畫面還在、或上一格還沒解完時不解 */
  protected async scanOnce(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (
      this.cameraState() !== 'scanning' ||
      !this.decoder ||
      !video ||
      this.decoding ||
      this.submitting() ||
      this.result() ||
      this.failure()
    ) {
      return;
    }
    this.decoding = true;
    try {
      const code = (await this.decoder(video))?.trim();
      if (!code) return;
      if (code === this.lastScan.code && Date.now() - this.lastScan.at < RESULT_SECONDS * 1000) {
        return;
      }
      this.lastScan = { code, at: Date.now() };
      this.submit(code);
    } finally {
      this.decoding = false;
    }
  }

  private stopCamera(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  /** 平板休眠／切走時關鏡頭（不一直開著），回來再開 */
  private onVisibilityChange(): void {
    if (document.hidden) {
      const state = this.cameraState();
      if (state === 'scanning' || state === 'starting') {
        this.resumeOnVisible = true;
        this.stopCamera();
        this.cameraState.set('off');
      }
    } else if (this.resumeOnVisible) {
      this.resumeOnVisible = false;
      void this.startCamera();
    }
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
    // 「8 秒內同一張卡不重送」從回到掃描這一刻起算 —— 結果畫面本身就停了 8 秒
    if (this.lastScan.code) this.lastScan.at = Date.now();
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
