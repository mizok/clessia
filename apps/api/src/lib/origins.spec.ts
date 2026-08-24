import { describe, expect, it } from 'vitest';

import { isAllowedOrigin, resolveTrustedOrigins, staticAllowedOrigins } from './origins';

describe('origin allowlist', () => {
  it('allows localhost and 127.0.0.1 on any port for local development', () => {
    expect(isAllowedOrigin('http://localhost:4200')).toBe(true);
    expect(isAllowedOrigin('http://localhost:58871')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4300')).toBe(true);
  });

  it('rejects untrusted non-local origins', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  it('builds trusted origins from static allowlist, configured web url, and request origin', () => {
    expect(
      resolveTrustedOrigins({
        requestOrigin: 'http://localhost:58871',
        webUrl: 'http://localhost:4200',
      }),
    ).toEqual(['http://localhost:4200', 'http://localhost:58871']);
  });

  // 正式站來源改成從 ALLOWED_ORIGINS 讀（c12：每個客戶自己的部署與網域，不能寫死）
  it('正式站來源從環境變數讀，逗號分隔', () => {
    expect(staticAllowedOrigins({ ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com' }))
      .toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('沒有設定時是空的 —— 只剩本機開發來源會被放行', () => {
    expect(staticAllowedOrigins({ ALLOWED_ORIGINS: '' })).toEqual([]);
    expect(staticAllowedOrigins({})).toEqual([]);
  });
});