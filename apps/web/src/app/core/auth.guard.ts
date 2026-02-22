import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait for initial session check to complete
  while (auth.loading()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};
