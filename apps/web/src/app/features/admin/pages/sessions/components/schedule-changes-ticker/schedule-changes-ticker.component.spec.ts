import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
    localStorage.removeItem('clessia.campusContext.single');
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

  it('左邊 h2「異動」＋「今天起 N 則」，批次算一則（數的是畫面上的項目）；區塊叫「近期異動」', async () => {
    const el = await setup([
      entry({ id: 'a' }),
      entry({ id: 'b1', sessionId: 'x1', isBatch: true, batchId: 'B', className: '國一理化' }),
      entry({ id: 'b2', sessionId: 'x2', isBatch: true, batchId: 'B', className: '國三數學' }),
    ]);
    const h2 = el.querySelector('section[aria-label="近期異動"] h2')!;
    expect(h2.textContent?.replace(/\s+/g, '')).toBe('異動今天起2則');
    expect(el.querySelectorAll('ul li').length).toBe(2);
  });

  // A6 `.tk__it`：when／班名／類型小標／細節（批次沒有班名與時間、多一個「批次」章）
  describe('每一則的四個欄位', () => {
    const texts = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('ul li button')).map((b) =>
        Array.from(b.children).map((c) => c.textContent?.replace(/\s+/g, ' ').trim()),
      );

    it('單堂：今天／明天／週X M/d ＋ 開始時間；班名；類型；冒號後的細節', async () => {
      const el = await setup([
        entry({
          id: 'a',
          sessionDate: '2026-08-15',
          sessionStartTime: '18:00',
          changeType: 'substitute',
          summary: '代課：劉建邦 → 江承睿',
        }),
        entry({ id: 'b', sessionId: 's2', sessionDate: '2026-08-16', sessionStartTime: '09:05' }),
        entry({
          id: 'c',
          sessionId: 's3',
          sessionDate: '2026-08-22',
          sessionStartTime: '13:00',
          changeType: 'reschedule',
          summary: '調課：8/19 → 8/22',
        }),
      ]);
      const [a, b, c] = texts(el);
      expect(a).toEqual(['今天 18:00', '國二數學 A', '代課', '劉建邦 → 江承睿']);
      expect(b).toEqual(['明天 09:05', '國二數學 A', '停課', '颱風']);
      expect(c).toEqual(['週六 8/22 13:00', '國二數學 A', '調課', '8/19 → 8/22']);
    });

    it('API 沒帶開始時間就只寫日子；沒有冒號又沒有原因就不畫細節', async () => {
      const el = await setup([entry({ reason: null })]);
      expect(texts(el)[0]).toEqual(['明天', '國二數學 A', '停課']);
    });

    it('批次：「明天」＋「停課 2 堂」＋原因＋「批次」章；沒有班名、沒有時間', async () => {
      const el = await setup([
        entry({ id: 'b1', isBatch: true, batchId: 'B', sessionStartTime: '17:00' }),
        entry({
          id: 'b2',
          sessionId: 's2',
          isBatch: true,
          batchId: 'B',
          sessionStartTime: '18:00',
        }),
      ]);
      expect(texts(el)[0]).toEqual(['明天', '停課 2 堂', '颱風', '批次']);
    });

    it('停課的小標是透明底＋細框（A6 stag--cancel），其他類型是 zinc-100 底', async () => {
      const el = await setup([
        entry({ id: 'a' }),
        entry({ id: 'b', sessionId: 's2', changeType: 'substitute', summary: '代課：甲 → 乙' }),
      ]);
      const tags = Array.from(el.querySelectorAll('ul li button span.inline-flex'));
      expect(tags[0].className).toContain('bg-transparent');
      expect(tags[0].className).toContain('shadow-[inset_0_0_0_1px_var(--zinc-500)]');
      expect(tags[0].className).not.toContain('bg-zinc-100');
      expect(tags[1].className).toContain('bg-zinc-100');
      expect(tags[1].className).not.toContain('shadow-');
    });
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
      expect(button.className).toContain('h-11'); // 基底 44（A27），桌機 wide:h-9
      expect(button.className).toContain('wide:h-9');
    }
  });

  it('右邊「全部異動」是按鈕（A6），點了把 fragment 設成 changes', async () => {
    const el = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const btn = Array.from(el.querySelectorAll('section > button')).find((b) =>
      b.textContent?.includes('全部異動'),
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(el.querySelector('a')).toBeNull();
    btn.click();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ fragment: 'changes', queryParamsHandling: 'preserve' }),
    );
  });

  describe('暫停鈕（A6 .tk__pause）', () => {
    const pauseBtn = (el: HTMLElement) =>
      el.querySelector('button[aria-label="暫停捲動"]') as HTMLButtonElement;

    it('按一下停住軌道（aria-pressed、animation-play-state:paused），再按繼續', async () => {
      const el = await setup();
      const track = el.querySelector('ul')!;
      expect(pauseBtn(el).getAttribute('aria-pressed')).toBe('false');
      expect(track.className).not.toContain('motion-safe:[animation-play-state:paused]');

      pauseBtn(el).click();
      fixture.detectChanges();
      expect(pauseBtn(el).getAttribute('aria-pressed')).toBe('true');
      expect(track.classList.contains('motion-safe:[animation-play-state:paused]')).toBe(true);

      pauseBtn(el).click();
      fixture.detectChanges();
      expect(pauseBtn(el).getAttribute('aria-pressed')).toBe('false');
      expect(track.classList.contains('motion-safe:[animation-play-state:paused]')).toBe(false);
    });

    it('reduced-motion 時不顯示（軌道本來就不動）；基底 44、桌機 32', async () => {
      const el = await setup();
      expect(pauseBtn(el).className).toContain('motion-reduce:hidden');
      expect(pauseBtn(el).className).toContain('size-11');
      expect(pauseBtn(el).className).toContain('wide:size-8');
    });
  });
});
