import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService, type UserRole } from './auth.service';

export function roleGuard(...allowed: UserRole[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    while (auth.loading()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/login']);
    }

    const active = auth.activeRole();
    if (active && allowed.includes(active)) {
      return true;
    }

    // No matching role — redirect to role picker or login
    return router.createUrlTree(auth.roles().length > 0 ? ['/select-role'] : ['/login']);
  };
}
