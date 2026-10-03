import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DailyCheckinsService, type DailyCheckinConfirmation } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { CheckinStationComponent, RESULT_SECONDS } from './checkin-station.component';

import { QR_DECODER_FACTORY } from './qr-camera';

/**
 * 解碼器換成可控的替身：真的解碼器要真的影像（選型邏輯在 qr-camera.spec 測）。
 * 走 DI 不走 `vi.mock('./qr-camera')` —— 本地模組被 builder 打包，mock 換不到（實測：拿到的是真的 jsqr 解碼器）。
 */
const decoderMock = vi.fn();

const confirmation: DailyCheckinConfirmation = {
  id: 'c1',
  studentId: 'stu-1',
  campusId: null,
  checkinDate: '2026-10-03',
  checkedInAt: '2026-10-03T09:40:00Z',
  student: { name: '王小明' },
  alreadyCheckedIn: false,
  attendanceMode: 'daily_checkin',
  todaySessions: [
    {
      sessionId: 's1',
      className: '國小五年級英文班',
      startTime: '17:00:00',
      endTime: '18:30:00',
      onLeave: false,
      attendance: 'present',
    },
  ],
};

async function setup(checkIn: ReturnType<typeof vi.fn>, opts: { camera?: 'auto' | 'manual' } = {}) {
  await TestBed.configureTestingModule({
    imports: [CheckinStationComponent],
    providers: [
      { provide: DailyCheckinsService, useValue: { checkIn } },
      { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-03' } },
      { provide: QR_DECODER_FACTORY, useValue: async () => decoderMock },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CheckinStationComponent);
  if (opts.camera) fixture.componentRef.setInput('camera', opts.camera);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const type = async (value: string) => {
    const input = q('checkin-code') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const click = (id: string) => {
    (q(id)?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  return { el, q, type, click, fixture };
}

afterEach(() => vi.useRealTimers());

describe('CheckinStationComponent（#1127）', () => {
  it('送卡號（去空白）＋台北今天、不送分校；顯示結果並清空欄位', async () => {
    const checkIn = vi.fn(() => of(confirmation));
    const { q, type } = await setup(checkIn);

    await type('  stu-1 ');

    expect(checkIn).toHaveBeenCalledWith({ studentId: 'stu-1', checkinDate: '2026-10-03' });
    expect(q('checkin-headline')?.textContent?.trim()).toBe('王小明，17:40 到班');
    expect(q('checkin-session')?.textContent).toContain('已記出席');
    expect((q('checkin-code') as HTMLInputElement).value).toBe('');
  });

  it(`${RESULT_SECONDS} 秒後自動回到掃描；「下一位」立刻回去`, async () => {
    vi.useFakeTimers();
    const { q, type, click, fixture } = await setup(vi.fn(() => of(confirmation)));

    await type('stu-1');
    vi.advanceTimersByTime((RESULT_SECONDS - 1) * 1000);
    fixture.detectChanges();
    expect(q('checkin-result')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(q('checkin-result')).toBeNull();

    await type('stu-1');
    click('checkin-next');
    expect(q('checkin-result')).toBeNull();
  });

  it('離線：「這次沒有記到」，再掃一次會用同一張卡重送', async () => {
    const checkIn = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValueOnce(of(confirmation));
    const { q, type, click } = await setup(checkIn);

    await type('stu-1');
    expect(q('checkin-failure-title')?.textContent?.trim()).toBe('這次沒有記到');

    click('checkin-retry');
    expect(checkIn).toHaveBeenLastCalledWith({ studentId: 'stu-1', checkinDate: '2026-10-03' });
    expect(q('checkin-failure')).toBeNull();
    expect(q('checkin-result')).not.toBeNull();
  });

  it('讀不到的卡：不顯示上一位的結果', async () => {
    const checkIn = vi
      .fn()
      .mockReturnValueOnce(of(confirmation))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { q, type } = await setup(checkIn);

    await type('stu-1');
    await type('nobody');

    expect(q('checkin-result')).toBeNull();
    expect(q('checkin-failure-title')?.textContent).toContain('這張卡讀不到學生');
  });

  it('空白不送', async () => {
    const checkIn = vi.fn(() => of(confirmation));
    const { type } = await setup(checkIn);
    await type('   ');
    expect(checkIn).not.toHaveBeenCalled();
  });
});

/**
 * #1127 相機掃描。機台（`camera="auto"`）一進頁就開鏡頭；管理端預設不開、給一顆按鈕
 * （計畫席裁：行政多半在桌機，一進頁就跳權限詢問很擾人）。
 */
describe('CheckinStationComponent —— 相機', () => {
  const stopTrack = vi.fn();
  let getUserMedia: ReturnType<typeof vi.fn>;
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  beforeEach(() => {
    stopTrack.mockReset();
    decoderMock.mockReset().mockResolvedValue(null);
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'mediaDevices', original);
    else delete (navigator as unknown as Record<string, unknown>)['mediaDevices'];
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  /** 開鏡頭是一串 await（權限 → play → 解碼器），讓它們都跑完再看畫面 */
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    // 用真的 macrotask（`setTimeout` 不在假時鐘裡）—— 只讓出 microtask 的話，
    // 動態 import 解碼器那一跳還沒回來
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  it('預設（管理端）不開鏡頭，按「開啟相機」才要權限、要的是後鏡頭', async () => {
    const { el, click, fixture } = await setup(vi.fn());
    await settle(fixture);

    expect(getUserMedia).not.toHaveBeenCalled();
    click('checkin-camera-open');
    await settle(fixture);

    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
    expect(el.textContent).toContain('把 QR Code 放進框內');
  });

  it('機台（auto）：一進頁就開鏡頭', async () => {
    const { el, fixture } = await setup(vi.fn(), { camera: 'auto' });
    await settle(fixture);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('把 QR Code 放進框內');
    expect(el.querySelector('[data-testid="checkin-camera-open"]')).toBeNull();
  });

  it('權限被拒：步驟說明＋「重新要求權限」，按了再要一次', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const { el, click, fixture } = await setup(vi.fn(), { camera: 'auto' });
    await settle(fixture);

    expect(el.textContent).toContain('鏡頭沒有開');
    click('checkin-camera-retry');
    await settle(fixture);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('把 QR Code 放進框內');
  });

  it('沒有鏡頭：請接掃碼槍或用卡號欄（卡號欄還在）', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('none', 'NotFoundError'));
    const { el, q, fixture } = await setup(vi.fn(), { camera: 'auto' });
    await settle(fixture);

    expect(el.textContent).toContain('這台裝置沒有可用的相機');
    expect(q('checkin-code')).not.toBeNull();
  });

  it('瀏覽器沒有 mediaDevices（非 HTTPS）：同「沒有鏡頭」', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    const { el, fixture } = await setup(vi.fn(), { camera: 'auto' });
    await settle(fixture);

    expect(el.textContent).toContain('這台裝置沒有可用的相機');
  });

  it('掃到就走同一條打卡路；結果畫面期間不再解碼；回來後同一張卡 8 秒內不重送', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const checkIn = vi.fn().mockReturnValue(of(confirmation));
    const { fixture, click } = await setup(checkIn, { camera: 'auto' });
    await settle(fixture);
    const scan = async () => {
      await (fixture.componentInstance as any).scanOnce();
      fixture.detectChanges();
    };

    decoderMock.mockResolvedValue('stu-1');
    await scan();
    expect(checkIn).toHaveBeenCalledWith({ studentId: 'stu-1', checkinDate: '2026-10-03' });

    decoderMock.mockClear();
    await scan();
    expect(decoderMock).not.toHaveBeenCalled(); // 結果畫面還在

    click('checkin-next');
    await scan();
    expect(checkIn).toHaveBeenCalledTimes(1); // 卡還停在鏡頭前

    vi.advanceTimersByTime(RESULT_SECONDS * 1000 + 1);
    await scan();
    expect(checkIn).toHaveBeenCalledTimes(2);
  });

  it('頁面隱藏（平板休眠）關鏡頭，回來再開；元件銷毀也關', async () => {
    const { fixture } = await setup(vi.fn(), { camera: 'auto' });
    await settle(fixture);
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const setHidden = (value: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    setHidden(true);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    setHidden(false);
    await settle(fixture);
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    fixture.destroy();
    expect(stopTrack).toHaveBeenCalledTimes(2);
    delete (document as unknown as Record<string, unknown>)['hidden'];
    if (hidden) Object.defineProperty(Document.prototype, 'hidden', hidden);
  });
});
