import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';

import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * guard 只透過 `isAuthenticatedWhenReady()` 問結果 —— 它自己保證「等首次載入完成」。
 * 這個 stub 刻意讓 promise 晚一拍 resolve：guard 若不等就會讀到還沒填好的狀態。
 */
function stubAuth(authed: boolean) {
  let settled = false;
  return {
    settledWhenAsked: () => settled,
    isAuthenticatedWhenReady: async () => {
      await Promise.resolve();
      settled = true;
      return authed;
    },
  };
}

async function run(auth: ReturnType<typeof stubAuth>) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  it('已登入就放行', async () => {
    const auth = stubAuth(true);

    expect(await run(auth)).toBe(true);
    expect(auth.settledWhenAsked()).toBe(true);
  });

  // 回歸點：原本是 while (loading()) 每 50ms 輪詢一次。改寫時若忘了等，
  // 已登入的人在首次載入完成前會被判定未登入、彈去 /login。
  it('沒登入導向 /login，而且是等首次載入完成之後才判定', async () => {
    const auth = stubAuth(false);
    const result = await run(auth);

    expect(String(result)).toBe('/login');
    expect(auth.settledWhenAsked()).toBe(true);
  });
});
