import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '@env/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // 只為 API 請求加上 withCredentials（讓 Better Auth cookie 自動附帶）
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }
  return next(req.clone({ withCredentials: true }));
};
