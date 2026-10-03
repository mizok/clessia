import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DailyCheckinsService, type DailyCheckinConfirmation } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { CheckinStationComponent, RESULT_SECONDS } from './checkin-station.component';

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

async function setup(checkIn: ReturnType<typeof vi.fn>) {
  await TestBed.configureTestingModule({
    imports: [CheckinStationComponent],
    providers: [
      { provide: DailyCheckinsService, useValue: { checkIn } },
      { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-03' } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CheckinStationComponent);
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
