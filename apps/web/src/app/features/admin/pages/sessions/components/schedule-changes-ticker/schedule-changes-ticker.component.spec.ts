import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CampusContextService } from '@core/campus-context.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { SystemClockService } from '@core/system-clock.service';

import { ScheduleChangesTickerComponent } from './schedule-changes-ticker.component';

const entry = (over: Partial<ChangeLogEntry> = {}): ChangeLogEntry => ({
  id: 'c1',
  sessionId: 's1',
  changeType: 'cancellation',
  summary: '停課',
  sessionDate: '2026-08-16',
  className: '國二數學 A',
  reason: '颱風',
  createdByName: '王主任',
  createdAt: '2026-08-10T03:00:00Z',
  isBatch: false,
  batchId: null,
  ...over,
});

describe('ScheduleChangesTickerComponent', () => {
  let fixture: ComponentFixture<ScheduleChangesTickerComponent>;
  const listChanges = vi.fn();

  async function setup(entries: ChangeLogEntry[] = [entry()], fail = false) {
    localStorage.removeItem('clessia.campusContext');
    listChanges
      .mockReset()
      .mockReturnValue(
        fail
          ? throwError(() => new Error('boom'))
          : of({ data: entries, meta: { total: entries.length, page: 1, pageSize: 100 } }),
      );
    await TestBed.configureTestingModule({
      imports: [ScheduleChangesTickerComponent],
      providers: [
        { provide: SessionsService, useValue: { listChanges } },
        {
          provide: ReferenceDataService,
          useValue: { campuses: signal([]), loadCampuses: vi.fn() },
        },
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-08-15') } },
        CampusContextService,
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ScheduleChangesTickerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('查今天起 7 天（含第 7 天）', async () => {
    await setup();
    expect(listChanges).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-08-15', to: '2026-08-22', page: 1, pageSize: 100 }),
    );
  });

  it('左邊寫「異動 · 今天起 N 則」，批次算一則（數的是畫面上的項目）', async () => {
    const el = await setup([
      entry({ id: 'a' }),
      entry({ id: 'b1', sessionId: 'x1', isBatch: true, batchId: 'B', className: '國一理化' }),
      entry({ id: 'b2', sessionId: 'x2', isBatch: true, batchId: 'B', className: '國三數學' }),
    ]);
    expect(el.textContent).toContain('異動 · 今天起 2 則');
    expect(el.textContent).toContain('停課 2 堂 · 颱風 · 批次');
    expect(el.textContent).toContain('8/16 國二數學 A 停課');
  });

  it('單堂點了回報 sessionId 與上課日', async () => {
    await setup();
    const picked = vi.fn();
    fixture.componentInstance.pickSession.subscribe(picked);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('ul button')!.click();
    expect(picked).toHaveBeenCalledWith({ sessionId: 's1', date: '2026-08-16' });
  });

  it('批次點了回報那一則的 key（有 batchId 用它）與上課日', async () => {
    await setup([
      entry({ id: 'b1', isBatch: true, batchId: 'B' }),
      entry({ id: 'b2', isBatch: true, batchId: 'B' }),
    ]);
    const picked = vi.fn();
    fixture.componentInstance.pickBatch.subscribe(picked);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('ul button')!.click();
    expect(picked).toHaveBeenCalledWith({ key: 'B', date: '2026-08-16' });
  });

  it('沒有異動或查詢失敗時整條不畫（不放一條永遠寫「0 則」的灰條）', async () => {
    expect((await setup([])).querySelector('section')).toBeNull();
    TestBed.resetTestingModule();
    expect((await setup([], true)).querySelector('section')).toBeNull();
  });

  /**
   * 會動的東西要能停（WCAG 2.2.2）：動畫只在 `motion-safe`，hover／focus 暫停，reduced-motion 時可橫捲。
   * jsdom 量不到動畫，**能斷言的是這幾個 class 都在**（拿掉任一個這條就紅）。
   */
  it('動畫只在 motion-safe、hover 與 focus 暫停、reduced-motion 可橫捲，每一則 ≥44px', async () => {
    const el = await setup();
    const track = el.querySelector('ul')!;
    expect(track.className).toContain('motion-safe:animate-ticker');
    expect(track.className).toContain('motion-safe:hover:[animation-play-state:paused]');
    expect(track.className).toContain('motion-safe:focus-within:[animation-play-state:paused]');
    expect(track.className).toContain('motion-reduce:pl-0');
    expect(track.parentElement!.className).toContain('motion-reduce:overflow-x-auto');
    for (const button of el.querySelectorAll('ul button')) {
      expect(button.className).toContain('min-h-11');
    }
  });

  it('右邊有「全部異動」連結（#changes）', async () => {
    const el = await setup();
    const link = el.querySelector('a[href*="#changes"]');
    expect(link?.textContent).toContain('全部異動');
  });
});
