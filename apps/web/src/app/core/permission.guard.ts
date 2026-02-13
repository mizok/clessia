import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export function permissionGuard(permission: string): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    while (auth.loading()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!auth.isAuthenticated()) {
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
}
