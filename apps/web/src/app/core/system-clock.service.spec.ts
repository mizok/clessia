import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';

import {
  EARLY_TIME_TIMEOUT_MS,
  SystemClockService,
  addDaysToDateString,
  taipeiDateString,
} from './system-clock.service';

describe('SystemClockService', () => {
  let service: SystemClockService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SystemClockService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('syncs from server when initialize is called', async () => {
    const initializePromise = service.initialize();
    const request = httpTestingController.expectOne('http://localhost:8787/api/system-time');
    request.flush({ epochMs: 1700000000000, iso: '2023-11-14T22:13:20.000Z' });
    await initializePromise;

    expect(service.synced()).toBe(true);
    expect(service.lastError()).toBeNull();
    expect(service.nowEpochMs()).toBeGreaterThanOrEqual(1700000000000);
  });

  it('stores sync error when server sync fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const syncPromise = service.syncWithServer();
    const request = httpTestingController.expectOne('http://localhost:8787/api/system-time');
    request.flush({ error: 'failed' }, { status: 500, statusText: 'Server Error' });
    await syncPromise;

    expect(service.synced()).toBe(false);
    expect(service.lastError()).toBe('SYNC_FAILED');
    consoleErrorSpy.mockRestore();
  });
});

// ── index.html 先發的 /api/system-time（#1595 1a）────────────────────────────────
// 開站的 AppInitializer 原本等 Angular 起來才發這支、再等它回來才導覽。現在 HTML 一解析就發；
// 用得上就不打第二趟，用不上（失敗、逾時、不是 JSON）一律退回原本的請求。
describe('SystemClockService — 開站先發的 /api/system-time', () => {
  const SERVER = 1700000000000;
  const TIME_URL = 'http://localhost:8787/api/system-time';
  type W = { __clessiaEarlyTime?: Promise<unknown> };

  function setup(early: Promise<unknown>) {
    (window as W).__clessiaEarlyTime = early;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      service: TestBed.inject(SystemClockService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => {
    delete (window as W).__clessiaEarlyTime;
    vi.useRealTimers();
  });

  it('用得上：直接用它，不打第二趟；用完就清掉', async () => {
    const { service, http } = setup(
      Promise.resolve({ body: { epochMs: SERVER }, at: performance.now() }),
    );
    await service.initialize();

    expect(service.synced()).toBe(true);
    http.expectNone(TIME_URL);
    expect((window as W).__clessiaEarlyTime).toBeUndefined();
  });

  // 先發的那支可能在 bootstrap 之前很久就回來了。基準點若取「接手當下」，
  // 中間那段會被當成伺服器時間沒走 —— 時鐘慢了那麼多
  it('時鐘基準是回應到達當下，不是接手當下', async () => {
    const { service } = setup(
      Promise.resolve({ body: { epochMs: SERVER }, at: performance.now() - 5000 }),
    );
    await service.initialize();

    expect(service.nowEpochMs()).toBeGreaterThanOrEqual(SERVER + 5000);
  });

  it('連線失敗：退回原本的請求', async () => {
    const { service, http } = setup(Promise.reject(new TypeError('Failed to fetch')));
    const done = service.initialize();
    await vi.waitFor(() => http.expectOne(TIME_URL).flush({ epochMs: SERVER, iso: '' }));
    await done;
    expect(service.synced()).toBe(true);
  });

  it('不是 JSON／5xx（index.html 把它記成 body: null）：退回原本的請求', async () => {
    for (const early of [
      Promise.reject(new SyntaxError('Unexpected token <')),
      Promise.resolve({ body: null, at: performance.now() }),
    ]) {
      TestBed.resetTestingModule();
      const { service, http } = setup(early);
      const done = service.initialize();
      await vi.waitFor(() => http.expectOne(TIME_URL).flush({ epochMs: SERVER, iso: '' }));
      await done;
      expect(service.synced()).toBe(true);
    }
  });

  it('逾時：放棄它、退回原本的請求，開站不會卡住', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { service, http } = setup(new Promise(() => undefined));
    const done = service.initialize();
    await vi.advanceTimersByTimeAsync(EARLY_TIME_TIMEOUT_MS);
    http.expectOne(TIME_URL).flush({ epochMs: SERVER, iso: '' });
    await done;
    expect(service.synced()).toBe(true);
  });
});

/**
 * #467：這一族 bug 的形狀是「函式擋住了時區，而它從參數走進來」。
 *
 * 下面每一條都刻意挑**在 UTC 與台北落在不同日曆日**的瞬間 —— 用同一天的
 * 瞬間當測資的話，UTC 版、本地版、台北版三種寫法會給出同一個答案，
 * **測試就從第一天起沒有辨識力**（而且在 CI 的 UTC 機器上永遠是綠的）。
 */
describe('taipeiDateString', () => {
  it('UTC 的傍晚是台北的隔天凌晨 —— 回台北那一天', () => {
    // 2026-09-06T16:30:00Z ＝ 台北 2026-09-07 00:30
    expect(taipeiDateString(Date.UTC(2026, 8, 6, 16, 30))).toBe('2026-09-07');
  });

  it('陷阱：同一個瞬間用 UTC 算會少一天', () => {
    const epochMs = Date.UTC(2026, 8, 6, 16, 30);

    // 這是**錯的**寫法，放在這裡是為了證明上面那條真的分得出來 ——
    // 兩者相等的話，那條測試就只是在覆述實作
    expect(new Date(epochMs).toISOString().slice(0, 10)).toBe('2026-09-06');
    expect(taipeiDateString(epochMs)).not.toBe(new Date(epochMs).toISOString().slice(0, 10));
  });

  it('台北的凌晨（UTC 前一天的下午四點之後）不會被算成前一天', () => {
    // 台北 2026-01-01 00:00 ＝ 2025-12-31T16:00:00Z，跨年是最貴的那個邊界
    expect(taipeiDateString(Date.UTC(2025, 11, 31, 16, 0))).toBe('2026-01-01');
  });

  it('台北的白天跟 UTC 同一天時兩者一致', () => {
    expect(taipeiDateString(Date.UTC(2026, 8, 6, 2, 0))).toBe('2026-09-06');
  });
});

describe('SystemClockService.todayTaipei', () => {
  let service: SystemClockService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SystemClockService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  /**
   * 基準是**跟伺服器對過的瞬間**，不是 `new Date()` —— 使用者的機器時鐘
   * 走掉了也還是對的。而且這條同時釘住時區：flush 的瞬間在 UTC 是 11-14、
   * 在台北是 11-15。
   */
  it('用伺服器給的瞬間換算台北日期，不是瀏覽器的本地日期也不是 UTC', async () => {
    const initializePromise = service.initialize();
    const request = httpTestingController.expectOne('http://localhost:8787/api/system-time');
    // 2023-11-14T22:13:20Z ＝ 台北 2023-11-15 06:13
    request.flush({ epochMs: 1700000000000, iso: '2023-11-14T22:13:20.000Z' });
    await initializePromise;

    expect(service.todayTaipei()).toBe('2023-11-15');
    // 回應裡的 `iso` 是 UTC —— 直接切它會少一天，這是最容易被「簡化」成的寫法
    expect(service.nowIso().slice(0, 10)).toBe('2023-11-14');
  });
});

/**
 * 純字串日期加減 —— **不含時刻，所以跟時區無關**（用 `Date.UTC` 只是避免
 * runtime 本地時區的日光節約規則介入運算）。測的全是會在真實資料上出現的邊界。
 */
describe('addDaysToDateString', () => {
  it('往前一天', () => {
    expect(addDaysToDateString('2026-09-06', -1)).toBe('2026-09-05');
  });

  it('跨月往前', () => {
    expect(addDaysToDateString('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('跨年往前', () => {
    expect(addDaysToDateString('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('閏年的 2/29 存在，往前一天是 2/28', () => {
    expect(addDaysToDateString('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('平年沒有 2/29，3/1 往前一天是 2/28', () => {
    expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('往後也對，且跨月', () => {
    expect(addDaysToDateString('2026-08-31', 1)).toBe('2026-09-01');
  });

  // 陷阱：`Date.now() - 86400000` 是對一個**瞬間**做算術。日光節約時間切換的
  // 那一天不是 24 小時，所以那種寫法會在切換日給出同一天或跳兩天。
  // 這支操作的是純日曆字串，沒有這個問題 —— 這條釘住「不要改回去用毫秒減」
  it('陷阱：日光節約切換日照樣只退一天（純日曆運算，不是減 86400000 毫秒）', () => {
    // 2026-03-08 是美國 DST 開始日（當地只有 23 小時）
    expect(addDaysToDateString('2026-03-09', -1)).toBe('2026-03-08');
    expect(addDaysToDateString('2026-03-08', -1)).toBe('2026-03-07');
  });
});
