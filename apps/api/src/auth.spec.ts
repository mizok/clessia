import { describe, expect, it } from 'vitest';

import { createAuth, crossSiteCookieAttributes, socialProvidersFromEnv } from './auth';

// 第一次上線的事故：前端在 clessia.pages.dev、API 在 *.workers.dev，兩者是不同 site，
// 預設 SameSite=Lax 的 session cookie 不會被帶到跨站請求上 —— 登入回 200，
// 但緊接著的 /api/me 一律 401，前端誤判成「此帳號尚未被指派角色」。
describe('crossSiteCookieAttributes', () => {
  it('正式站（https）發跨站可用的 cookie', () => {
    expect(crossSiteCookieAttributes('https://clessia-api-production.example.workers.dev')).toEqual({
      sameSite: 'none',
      secure: true,
      partitioned: true,
    });
  });

  // Partitioned 是 Safari 18.4+ 接受第三方 cookie 的條件（CHIPS）
  it('帶 Partitioned —— 少了它 Safari 18.4+ 會丟掉 cookie', () => {
    expect(crossSiteCookieAttributes('https://api.example.com')?.partitioned).toBe(true);
  });

  // 在 http 上發 Secure cookie 會被瀏覽器丟掉，會把本機開發整個弄壞
  it('本機開發（http）不覆寫 —— localhost 之間本來就是同站', () => {
    expect(crossSiteCookieAttributes('http://localhost:8787')).toBeUndefined();
    expect(crossSiteCookieAttributes('http://127.0.0.1:8787')).toBeUndefined();
  });
});

// 純函式對了還不夠 —— 它得真的被接進 betterAuth 的設定。上一個 CORS 事故就是
// 「函式寫對了但沒接上」，而單元測試看不見接線。
describe('createAuth 的 cookie 接線', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    WEB_URL: 'https://app.example.com',
    ALLOWED_ORIGINS: '',
    LINE_CLIENT_ID: '',
    LINE_CLIENT_SECRET: '',
  };

  it('正式站把跨站屬性接進 defaultCookieAttributes', () => {
    const auth = createAuth({ ...baseEnv, BETTER_AUTH_URL: 'https://api.example.com' });

    expect(auth.options.advanced?.defaultCookieAttributes).toEqual({
      sameSite: 'none',
      secure: true,
      partitioned: true,
    });
  });

  it('本機開發不覆寫，維持 Better Auth 的預設', () => {
    const auth = createAuth({ ...baseEnv, BETTER_AUTH_URL: 'http://localhost:8787' });

    expect(auth.options.advanced?.defaultCookieAttributes).toBeUndefined();
  });
});

// Google 延後但不排除（見 kb/wiki/architecture/line-oauth-login.md 決策二）：
// provider 清單必須從 env 組出來，不能寫死成「只有 LINE」，否則加 Google 要回頭重做。
describe('socialProvidersFromEnv', () => {
  it('兩個變數都有才設定 line', () => {
    expect(
      socialProvidersFromEnv({ LINE_CLIENT_ID: 'cid', LINE_CLIENT_SECRET: 'secret' })
    ).toEqual({ line: { clientId: 'cid', clientSecret: 'secret' } });
  });

  it('少一個就不設定 —— 半套設定比沒設定更難查', () => {
    expect(socialProvidersFromEnv({ LINE_CLIENT_ID: 'cid', LINE_CLIENT_SECRET: '' })).toEqual({});
    expect(socialProvidersFromEnv({ LINE_CLIENT_ID: '', LINE_CLIENT_SECRET: 'secret' })).toEqual({});
    expect(socialProvidersFromEnv({})).toEqual({});
  });

  it('回傳的是可擴充的 map，不是寫死的單一 provider', () => {
    const providers = socialProvidersFromEnv({
      LINE_CLIENT_ID: 'cid',
      LINE_CLIENT_SECRET: 'secret',
    });
    expect(Object.keys(providers)).toEqual(['line']);
  });
});

describe('createAuth 的 social provider 接線', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    BETTER_AUTH_URL: 'https://api.example.com',
    WEB_URL: 'https://app.example.com',
    ALLOWED_ORIGINS: '',
  };

  it('把 line 接進 betterAuth 的 socialProviders', () => {
    const auth = createAuth({
      ...baseEnv,
      LINE_CLIENT_ID: 'cid',
      LINE_CLIENT_SECRET: 'secret',
    });

    expect(auth.options.socialProviders?.['line']?.clientId).toBe('cid');
  });

  it('沒設定 LINE 時不掛任何 provider', () => {
    const auth = createAuth({ ...baseEnv, LINE_CLIENT_ID: '', LINE_CLIENT_SECRET: '' });

    expect(auth.options.socialProviders).toEqual({});
  });
});
