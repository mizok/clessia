import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!(await auth.isAuthenticatedWhenReady())) {
    return true;
  }

  // 已登入：送去他該去的地方。選過角色就直接進那個 shell，
  // 沒選過（多重角色）就先去選。
  const activeRole = auth.activeRole();

  return router.createUrlTree([activeRole ? `/${activeRole}` : '/select-role']);
};
