import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { OrgSettingsService } from './org-settings.service';

const SETTINGS = {
  id: 'org-1',
  name: 'Clessia Demo',
  attendanceMode: 'per_session' as const,
  attendanceResponsible: 'teacher' as const,
  attendanceRetroactiveDays: 7,
};

/**
 * 這一支測的是 `load()` **自己**，不是某個頁面對 `status` 的反應。
 *
 * 分開測的理由：頁面的 spec 把整個 service 換成替身（`status` 直接給值），
 * 於是「`load()` 失敗時有沒有把 status 設成 failed」在那邊**一支測試都碰不到** ——
 * 我把 error 分支整個刪掉，頁面的 18 支測試照樣全綠。
 * **替身比真實系統寬容**（見 kb/wiki/lessons/silent-tool-failures）。
 */
describe('OrgSettingsService.load()', () => {
  let service: OrgSettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrgSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('初始是 unloaded —— 不是 ready，也不是 failed', () => {
    expect(service.status()).toBe('unloaded');
    expect(service.settings()).toBeNull();
  });

  it('成功：填 settings 並轉 ready', () => {
    service.load();
    http.expectOne((r) => r.url.endsWith('/api/org/settings')).flush(SETTINGS);

    expect(service.status()).toBe('ready');
    expect(service.settings()?.attendanceResponsible).toBe('teacher');
  });

  it('失敗：轉 failed，而且 settings 維持 null —— 兩個狀態不共用一個值', () => {
    service.load();
    http
      .expectOne((r) => r.url.endsWith('/api/org/settings'))
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.status()).toBe('failed');
    expect(service.settings()).toBeNull();
  });
});
