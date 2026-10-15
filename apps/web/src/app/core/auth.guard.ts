import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
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

/**
 * #1595 P3a：guard 等 `/api/me` 的這段時間，先把要去的那一串頁面的 lazy chunk 抓下來。
 * 路由器要等 guard 放行才叫 `loadComponent`，原本 chunk 下載排在 `/api/me` 後面；
 * guard 執行時路由樹已經辨識完，所以這裡就知道整串要哪些 chunk。
 *
 * 只是下載公開的 js，**不建構元件、不打資料 API**，放不放行仍由 guard 決定 ——
 * 未登入的人照樣被導走，受保護的畫面不會出現。之後路由器自己再叫一次 `import()`
 * 拿到的是同一份已載入的模組。失敗就算了，正式載入時 chunk-recovery 會處理。
 */
export function prefetchRouteChunks(state: RouterStateSnapshot): void {
  for (let r: ActivatedRouteSnapshot | null = state.root ?? null; r; r = r.firstChild) {
    const loading = r.routeConfig?.loadComponent?.();
    if (loading instanceof Promise) loading.catch(() => undefined);
  }
}

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  prefetchRouteChunks(state);

  if (await auth.isAuthenticatedWhenReady()) {
    return true;
  }

  return unauthenticatedRedirect(auth, router);
};
