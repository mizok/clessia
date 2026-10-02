import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { loginLinkErrorDetail } from './login-link-error.util';

const http = (code: string, status = 422) =>
  new HttpErrorResponse({ status, error: { error: '後端的話', code } });

describe('loginLinkErrorDetail（#1006）', () => {
  it('NO_EMAIL → 告訴使用者先補 Email', () => {
    expect(loginLinkErrorDetail(http('NO_EMAIL'), '家長')).toBe(
      '這位家長沒有 Email，請先補上再產生連結',
    );
  });

  it('NO_ROLES → 說帳號沒有角色', () => {
    expect(loginLinkErrorDetail(http('NO_ROLES'), '人員')).toContain('沒有任何角色');
  });

  it('LINK_FAILED → 說是連結產生失敗，可以重試', () => {
    expect(loginLinkErrorDetail(http('LINK_FAILED'), '家長')).toContain('稍後再試');
  });

  it('403 → 照伺服器說的原因（含 #966 的 OUT_OF_SCOPE），不用寫死文案蓋掉', () => {
    expect(loginLinkErrorDetail(http('OUT_OF_SCOPE', 403), '家長')).toBe('後端的話');
    expect(loginLinkErrorDetail(http('FORBIDDEN', 403), '家長')).toBe('後端的話');
  });

  it('403 但伺服器沒給訊息 → 退回「沒有權限」文案，而不是叫人重試', () => {
    const e = new HttpErrorResponse({ status: 403, error: { code: 'FORBIDDEN' } });
    expect(loginLinkErrorDetail(e, '家長')).toContain('權限');
  });

  it('未知錯誤碼或非 HTTP 錯誤 → 退回通用句，不噴物件', () => {
    expect(loginLinkErrorDetail(http('???'), '家長')).toBe('請稍後再試');
    expect(loginLinkErrorDetail(new Error('x'), '家長')).toBe('請稍後再試');
  });
});
