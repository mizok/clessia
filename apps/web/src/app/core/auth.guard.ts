import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * 「沒登入」該導去哪 —— authGuard / roleGuard / permissionGuard 共用同一套判斷。
 * `connectionError` 是 true 代表這不是確定的未登入（見 AuthService.loadProfile），
 * 帶 `reason=connection-error` 讓登入頁顯示「連線異常，請重試」而不是普通登入畫面。
 */
export function unauthenticatedRedirect(auth: AuthService, router: Router): UrlTree {
  if (auth.connectionError()) {
    return router.createUrlTree(['/login'], { queryParams: { reason: 'connection-error' } });
  }
  return router.createUrlTree(['/login']);
}

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (await auth.isAuthenticatedWhenReady()) {
    return true;
  }

  return unauthenticatedRedirect(auth, router);
};
