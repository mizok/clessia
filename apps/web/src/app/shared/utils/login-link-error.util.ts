import { HttpErrorResponse } from '@angular/common/http';

/**
 * 登入連結端點（`POST /api/login-links`）失敗時給使用者的一句可行動的話。
 * 家長頁與人員頁打的是同一支端點，所以共用；`who` 是「家長」／「人員」。
 * 錯誤碼見 `apps/api/src/routes/login-links.ts`。
 */
export function loginLinkErrorDetail(err: unknown, who: string): string {
  const code =
    err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : '';

  switch (code) {
    case 'NO_EMAIL':
      return `這位${who}沒有 Email，請先補上再產生連結`;
    case 'NO_ROLES':
      return `這位${who}的帳號還沒有任何角色，請先指派角色`;
    case 'LINK_FAILED':
      return '連結產生失敗，請稍後再試';
    case 'FORBIDDEN':
      return `你沒有替這位${who}產生連結的權限`;
    default:
      return '請稍後再試';
  }
}
