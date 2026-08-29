import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';

import { AuthService, type UserRole } from './auth.service';
import { guestGuard } from './guest.guard';

function stubAuth(over: { authed?: boolean; roles?: UserRole[]; activeRole?: UserRole | null }) {
  return {
    loading: signal(false),
    isAuthenticated: signal(over.authed ?? false),
    roles: signal<UserRole[]>(over.roles ?? []),
    activeRole: signal<UserRole | null>(over.activeRole ?? null),
  };
}

async function run(auth: ReturnType<typeof stubAuth>) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  return TestBed.runInInjectionContext(() =>
    guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
}

describe('guestGuard —— 登入後該去哪', () => {
  it('沒登入就讓他留在公開頁', async () => {
    expect(await run(stubAuth({ authed: false }))).toBe(true);
  });

  it('單一角色：已經有 activeRole，直接進該角色的 shell', async () => {
    const result = await run(stubAuth({ authed: true, roles: ['teacher'], activeRole: 'teacher' }));

    expect(String(result)).toBe('/teacher');
  });

  /**
   * 這條在 `/select-role` 還是 dialog 的時候是壞的：guard 導向一條沒有註冊的路由，
   * 被 wildcard 收去 `/login`，guestGuard 再把人送回 `/select-role` —— 無限重導向。
   */
  it('多重角色且還沒選過：導向 /select-role，而且那條路由必須真的存在', async () => {
    const result = await run(
      stubAuth({ authed: true, roles: ['admin', 'teacher'], activeRole: null }),
    );

    expect(String(result)).toBe('/select-role');
  });
});
