import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export function permissionGuard(permission: string): CanActivateFn {
  const guard: CanActivateFn = async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!(await auth.isAuthenticatedWhenReady())) {
      return router.createUrlTree(['/login']);
    }

    // Check if user has the required permission
    if (auth.hasPermission(permission)) {
      return true;
    }

    // If not, redirect to their default shell or show access denied
    // For now, redirect to matching role shell or home
    const role = auth.activeRole();
    if (role) {
      // If they are admin but don't have permission, maybe redirect to admin dashboard root
      // preventing infinite loop if root also requires permission (unlikely for dashboard home)
      return router.createUrlTree(['/' + role]);
    }

    return router.createUrlTree(['/login']);
  };

  // 守的是哪一個權限要看得見 —— 否則「路由掛了 guard」與「掛的是對的 guard」
  // 在測試裡無法區分（見 app.routes.spec.ts）。
  return Object.assign(guard, { permission });
}
