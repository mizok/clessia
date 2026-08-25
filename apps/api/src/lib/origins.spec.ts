import { describe, expect, it } from 'vitest';

import {
  allowedOrigins,
  isAllowedOrigin,
  resolveCorsOrigin,
  resolveTrustedOrigins,
} from './origins';

const PROD_ENV = {
  WEB_URL: 'https://clessia.pages.dev',
  ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
};

describe('allowedOrigins', () => {
  it('把 WEB_URL 和 ALLOWED_ORIGINS 合併 —— WEB_URL 依定義可信，不必重複列', () => {
    expect(allowedOrigins(PROD_ENV)).toEqual([
      'https://clessia.pages.dev',
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('只有 WEB_URL 也能用（ALLOWED_ORIGINS 是選配）', () => {
    expect(allowedOrigins({ WEB_URL: 'https://clessia.pages.dev' })).toEqual([
      'https://clessia.pages.dev',
    ]);
  });

  it('正規化成 origin：路徑與尾斜線會被丟掉', () => {
    expect(allowedOrigins({ WEB_URL: 'https://clessia.pages.dev/login' })).toEqual([
      'https://clessia.pages.dev',
    ]);
  });

  it('空值與垃圾值被濾掉，不會產生空字串來源', () => {
    expect(allowedOrigins({ WEB_URL: '', ALLOWED_ORIGINS: ' , not-a-url, ' })).toEqual([]);
    expect(allowedOrigins({})).toEqual([]);
  });
});

describe('isAllowedOrigin', () => {
  it('本機開發來源任意 port 都放行', () => {
    expect(isAllowedOrigin('http://localhost:4200')).toBe(true);
    expect(isAllowedOrigin('http://localhost:58871')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4300')).toBe(true);
  });

  it('拒絕不在清單上的非本機來源', () => {
    expect(isAllowedOrigin('https://evil.example.com', allowedOrigins(PROD_ENV))).toBe(false);
  });

  // 這條是本次事故的直接迴歸測試：允許清單接上之後，正式站來源必須真的過得了
  it('放行設定在 WEB_URL 的正式站來源', () => {
    expect(isAllowedOrigin('https://clessia.pages.dev', allowedOrigins(PROD_ENV))).toBe(true);
  });

  it('放行 ALLOWED_ORIGINS 列出的額外來源', () => {
    expect(isAllowedOrigin('https://b.example.com', allowedOrigins(PROD_ENV))).toBe(true);
  });

  it('沒有帶允許清單時，正式站來源一律被拒 —— fail-closed', () => {
    expect(isAllowedOrigin('https://clessia.pages.dev')).toBe(false);
  });
});

describe('resolveCorsOrigin', () => {
  it('回傳正規化後的來源給 CORS header', () => {
    expect(resolveCorsOrigin('https://clessia.pages.dev', allowedOrigins(PROD_ENV))).toBe(
      'https://clessia.pages.dev',
    );
  });

  it('不被允許的來源回 undefined（等於不發 allow-origin header）', () => {
    expect(resolveCorsOrigin('https://evil.example.com', allowedOrigins(PROD_ENV))).toBeUndefined();
  });
});

describe('resolveTrustedOrigins', () => {
  it('清單加上通過檢查的請求來源', () => {
    expect(
      resolveTrustedOrigins({
        requestOrigin: 'http://localhost:58871',
        allowed: allowedOrigins({ WEB_URL: 'http://localhost:4200' }),
      }),
    ).toEqual(['http://localhost:4200', 'http://localhost:58871']);
  });

  it('不被允許的請求來源不會被加進去', () => {
    expect(
      resolveTrustedOrigins({
        requestOrigin: 'https://evil.example.com',
        allowed: allowedOrigins(PROD_ENV),
      }),
    ).toEqual(['https://clessia.pages.dev', 'https://a.example.com', 'https://b.example.com']);
  });
});
