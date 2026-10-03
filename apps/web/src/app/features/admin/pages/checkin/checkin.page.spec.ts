import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { DailyCheckinsService } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { CheckinPage } from './checkin.page';

describe('CheckinPage（/admin/checkin，#1127）', () => {
  it('掛跟機台同一個打卡站', async () => {
    await TestBed.configureTestingModule({
      imports: [CheckinPage],
      providers: [
        { provide: DailyCheckinsService, useValue: { checkIn: vi.fn() } },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-03' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CheckinPage);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-checkin-station')).not.toBeNull();
  });
});
