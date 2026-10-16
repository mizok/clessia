import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { PushService } from './push.service';

/**
 * #1663：登出前先刪這台裝置的推播訂閱，否則上一個人的繳費提醒會跳到下一個人的裝置上。
 * DELETE 要帶登入 cookie，所以**順序**是這支要守的東西 —— 登出之後才刪就刪不掉了。
 *
 * better-auth 的 client 是 Proxy，spyOn 不上它的 `signOut`，底層的 fetch 也在載入時就抓好了 ——
 * 所以看登出流程的最後一步（導回 /login）：訂閱還沒刪完之前，整個登出不能往下走。
 * 「先打 DELETE」那半段由 push.service.spec 守。
 */
describe('AuthService.signOut：推播訂閱（#1663）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('先刪這台裝置的訂閱，等它做完登出才往下走', async () => {
    // better-auth 的 signOut 會真的打 API；不替身的話，這支只在 8787 剛好有人起著 API 時才綠（#1679 撞到）。
    // 替身得到是因為 auth-client.ts 每次呼叫才取 fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })),
    );
    let finish!: () => void;
    const forget = vi.fn(() => new Promise<void>((done) => (finish = done)));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PushService, useValue: { forgetThisDevice: forget } },
      ],
    });
    const service = TestBed.inject(AuthService);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const out = service.signOut();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(forget).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    finish();
    await out;
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
