import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { environment } from '@env/environment';

/**
 * Auth Interceptor
 *
 * 自動為發往 API 的請求添加 Authorization header
 * 只處理發往 apiUrl 的請求，其他請求不處理
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // 只處理發往我們 API 的請求
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const supabase = inject(SupabaseService);

  return from(supabase.client.auth.getSession()).pipe(
    switchMap(({ data: { session } }) => {
      if (session?.access_token) {
        const cloned = req.clone({
          headers: req.headers.set('Authorization', `Bearer ${session.access_token}`),
        });
        return next(cloned);
      }
      return next(req);
    })
  );
};
