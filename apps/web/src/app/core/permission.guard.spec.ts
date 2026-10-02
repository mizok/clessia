import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { AuthService, type UserRole } from './auth.service';
import { permissionGuard } from './permission.guard';

function run(permissions: string[], permission = 'manage_staff') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: {
          activeRole: signal<UserRole | null>('admin'),
          isAuthenticatedWhenReady: () => Promise.resolve(true),
          hasPermission: (p: string) => permissions.includes(p) || permissions.includes('*'),
        },
      },
    ],
  });
  return TestBed.runInInjectionContext(() =>
    permissionGuard(permission)({} as never, {} as never),
  ) as Promise<boolean | UrlTree>;
}

/**
 * #1059：人員管理頁只有 `manage_staff` 的管理員進得了。藏選單擋不住直接打網址，
 * 所以要看 guard 本身的行為，不只是「路由上掛了它」（那條在 app.routes.spec.ts）。
 */
describe('permissionGuard', () => {
  it('沒有權限的管理員被導回自己角色的首頁', async () => {
    const result = await run([]);

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/admin');
  });

  it('有權限就放行', async () => {
    expect(await run(['manage_staff'])).toBe(true);
  });

  it('萬用權限 `*` 也放行', async () => {
    expect(await run(['*'])).toBe(true);
  });
});
