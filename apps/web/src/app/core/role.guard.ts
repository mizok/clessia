import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { unauthenticatedRedirect } from './auth.guard';
import { AuthService, type UserRole } from './auth.service';

export function roleGuard(...allowed: UserRole[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!(await auth.isAuthenticatedWhenReady())) {
      return unauthenticatedRedirect(auth, router);
    }

    const active = auth.activeRole();
    if (active && allowed.includes(active)) {
      return true;
    }

    // No matching role — redirect to role picker or login
    return router.createUrlTree(auth.roles().length > 0 ? ['/select-role'] : ['/login']);
  };
}
