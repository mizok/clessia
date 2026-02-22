import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait for initial session check to complete
  while (auth.loading()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (!auth.isAuthenticated()) {
    return true;
  }

  // If authenticated, redirect to default shell
  const activeRole = auth.activeRole();
  if (activeRole) {
    // Navigate to role's shell (e.g. /admin)
    // We can't use auth.navigateToRoleShell() because it returns void and we are in a guard.
    // We should return a UrlTree or boolean.
    // However, since we want to redirect, returning a UrlTree is best.
    // auth.navigateToRoleShell does side effects (close picker), but here we just want routing.
    // We can manually construct the path based on logic in AuthService or just hardcode/map it.
    // Ideally we reuse the map from AuthService, but it's private.
    // Let's assume standard paths: /admin, /teacher, /parent
    return router.createUrlTree(['/' + activeRole]);
  }

  // If authenticated but no active role (e.g. multiple roles), go to role selection
  return router.createUrlTree(['/select-role']);
};
