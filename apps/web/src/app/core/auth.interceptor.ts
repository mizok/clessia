import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '@env/environment';
import { ACTIVE_ROLE_STORAGE_KEY } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // 只為 API 請求加上 withCredentials（讓 Better Auth cookie 自動附帶）
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  // 告訴後端「此刻以什麼身分在看」—— `authMiddleware` 驗證過是這個人的角色之一才採信
  // （見 lib/active-role.ts）。同時是老師又是家長的人切到家長身分時，公告收件匣
  // 才看得到家長那份，而不是角色陣列裡排比較前面的老師身分（#291）。
  //
  // **不 inject `AuthService`**：`AuthService` 自己的首次載入（`/api/me`）會經過
  // 這支攔截器，注入同一個還在建構中的 service 會撞循環 DI。直接讀它寫的
  // localStorage 鍵就好，兩邊共用同一個常數避免鍵名漂移。
  let activeRole: string | null = null;
  try {
    activeRole = localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY);
  } catch {
    activeRole = null;
  }
  const headers = activeRole ? req.headers.set('X-Active-Role', activeRole) : req.headers;

  return next(req.clone({ withCredentials: true, headers }));
};
