import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '@core/auth.service';
import { DailyCheckinsService } from '@core/daily-checkins.service';
import { SystemClockService } from '@core/system-clock.service';
import { CheckinStationComponent } from '@shared/components/checkin-station/checkin-station.component';
import { KioskCheckinPage } from './kiosk-checkin.page';

describe('KioskCheckinPage（#1127）', () => {
  it('顯示機台名稱、掛打卡站、可登出', async () => {
    const signOut = vi.fn();
    await TestBed.configureTestingModule({
      imports: [KioskCheckinPage],
      providers: [
        {
          provide: AuthService,
          useValue: { profile: signal({ display_name: '本校門口' }), signOut },
        },
        { provide: DailyCheckinsService, useValue: { checkIn: vi.fn() } },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-03' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KioskCheckinPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="kiosk-station"]')?.textContent?.trim()).toBe('本校門口');
    // 機台一進頁就開鏡頭（管理端預設不開，#1127）
    const station = fixture.debugElement.query(By.directive(CheckinStationComponent));
    expect(station.componentInstance.camera()).toBe('auto');
    (el.querySelector('p-button button') as HTMLButtonElement).click();
    expect(signOut).toHaveBeenCalled();
  });
});
