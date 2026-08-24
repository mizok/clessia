import { describe, expect, it } from 'vitest';

import { createAuth, crossSiteCookieAttributes } from './auth';

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
