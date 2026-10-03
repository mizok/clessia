import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DailyCheckinsService } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { CheckinStationComponent, checkinErrorMessage } from './checkin-station.component';

const confirmation = {
  id: 'c1',
  studentId: 'stu-1',
  campusId: null,
  checkinDate: '2026-10-03',
  checkedInAt: '2026-10-03T08:00:00Z',
  student: { name: '王小明' },
  todaySessions: [
    { sessionId: 's1', className: '國小五年級英文班', startTime: '17:00:00', endTime: '18:30:00' },
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
  const type = async (value: string) => {
    const input = el.querySelector('[data-testid="checkin-code"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { el, type };
}

describe('CheckinStationComponent（#1127）', () => {
  it('送卡號（去空白）＋台北今天，不送分校；顯示學生名與今日課堂', async () => {
    const checkIn = vi.fn(() => of(confirmation));
    const { el, type } = await setup(checkIn);

    await type('  stu-1 ');

    expect(checkIn).toHaveBeenCalledWith({ studentId: 'stu-1', checkinDate: '2026-10-03' });
    expect(el.querySelector('[data-testid="checkin-student"]')?.textContent?.trim()).toBe('王小明');
    expect(el.querySelector('[data-testid="checkin-session"]')?.textContent).toContain(
      '17:00–18:30',
    );
    // 掃碼器下一張卡直接打進來
    expect((el.querySelector('[data-testid="checkin-code"]') as HTMLInputElement).value).toBe('');
  });

  it('沒有課的那天說「今天沒有排課」', async () => {
    const { el, type } = await setup(vi.fn(() => of({ ...confirmation, todaySessions: [] })));
    await type('stu-1');
    expect(el.querySelector('[data-testid="checkin-result"]')?.textContent).toContain('今天沒有排課');
  });

  it('失敗時顯示給學生看的話，不顯示上一位的結果', async () => {
    const checkIn = vi
      .fn()
      .mockReturnValueOnce(of(confirmation))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { el, type } = await setup(checkIn);

    await type('stu-1');
    await type('nobody');

    expect(el.querySelector('[data-testid="checkin-result"]')).toBeNull();
    expect(el.textContent).toContain('找不到這張卡');
  });

  it('空白不送', async () => {
    const checkIn = vi.fn(() => of(confirmation));
    const { type } = await setup(checkIn);
    await type('   ');
    expect(checkIn).not.toHaveBeenCalled();
  });
});

describe('checkinErrorMessage', () => {
  it.each([
    [404, '找不到這張卡'],
    [403, '不能在這裡打卡'],
    [401, '重新登入'],
    [500, '再試一次'],
  ])('%i', (status, text) => {
    expect(checkinErrorMessage(new HttpErrorResponse({ status }))).toContain(text);
  });
});
