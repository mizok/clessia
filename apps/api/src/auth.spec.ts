import { describe, expect, it } from 'vitest';

import { createAuth, lineProfileToUser, magicLinkOptions, socialProvidersFromEnv } from './auth';

// 第一次上線的事故：前端在 clessia.pages.dev、API 在 *.workers.dev，兩者是不同 site，
// 預設 SameSite=Lax 的 session cookie 不會被帶到跨站請求上 —— 登入回 200，
// 但緊接著的 /api/me 一律 401，前端誤判成「此帳號尚未被指派角色」。
describe('createAuth 的 cookie 接線', () => {
  const baseEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    WEB_URL: 'https://app.example.com',
    ALLOWED_ORIGINS: '',
    LINE_CLIENT_ID: '',
    LINE_CLIENT_SECRET: '',
  };

  // 前端與 API 現在同源（demo.clessia.cc 與 demo.clessia.cc/api），所以 cookie 是
  // 第一方的，Better Auth 的預設 SameSite=Lax 就是對的。
  //
  // **不要再覆寫成 SameSite=None; Partitioned** —— 那是跨站部署時的權宜之計，而且
  // `Partitioned` 會打斷 OAuth：state cookie 在「前端發的 XHR」時被設定（分區鍵是前端），
  // 但 callback 是「LINE 導回來的頂層導航」（分區鍵不同），cookie 送不出去 →
  // 每次登入都 state_mismatch。實際踩過。
  it('不覆寫 cookie 屬性 —— 同源部署用 Better Auth 的預設就對了', () => {
    const auth = createAuth({ ...baseEnv, BETTER_AUTH_URL: 'https://demo.clessia.cc' });

    // cast 是必要的：`advanced` 已經不在型別上（那本身就是一層保證），
    // 但有人加回來時這條測試仍然要紅
    const options = auth.options as unknown as {
      advanced?: { defaultCookieAttributes?: unknown };
    };
    expect(options.advanced?.defaultCookieAttributes).toBeUndefined();
  });
});

// Google 延後但不排除（見 kb/wiki/architecture/line-oauth-login.md 決策二）：
// provider 清單必須從 env 組出來，不能寫死成「只有 LINE」，否則加 Google 要回頭重做。
describe('socialProvidersFromEnv', () => {
  it('兩個變數都有才設定 line', () => {
    const line = socialProvidersFromEnv({
      LINE_CLIENT_ID: 'cid',
      LINE_CLIENT_SECRET: 'secret',
    })['line'];

    expect(line).toMatchObject({ clientId: 'cid', clientSecret: 'secret', disableSignUp: true });
    // LINE 不給 email，這個 mapper 是登入能不能成立的前提
    expect(line?.['mapProfileToUser']).toBe(lineProfileToUser);
  });

  it('少一個就不設定 —— 半套設定比沒設定更難查', () => {
    expect(socialProvidersFromEnv({ LINE_CLIENT_ID: 'cid', LINE_CLIENT_SECRET: '' })).toEqual({});
    expect(socialProvidersFromEnv({ LINE_CLIENT_ID: '', LINE_CLIENT_SECRET: 'secret' })).toEqual(
      {},
    );
    expect(socialProvidersFromEnv({})).toEqual({});
  });

  // 預設 disableSignUp 是 false —— 任何路人按下 LINE 登入就會被建一個沒有角色、
  // 沒有 orgId 的孤兒帳號。這個系統的帳號一律由校方建立，OAuth 只負責「認人」。
  it('禁止用 LINE 自助註冊', () => {
    const providers = socialProvidersFromEnv({
      LINE_CLIENT_ID: 'cid',
      LINE_CLIENT_SECRET: 'secret',
    });

    expect(providers['line']?.['disableSignUp']).toBe(true);
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

    expect(auth.options.socialProviders?.['line']?.['clientId']).toBe('cid');
  });

  it('沒設定 LINE 時不掛任何 provider', () => {
    const auth = createAuth({ ...baseEnv, LINE_CLIENT_ID: '', LINE_CLIENT_SECRET: '' });

    expect(auth.options.socialProviders).toEqual({});
  });
});

// 綁定連結、破窗 CLI、重發連結三個用途共用 magic-link。
// 我們不寄信 —— sendMagicLink 收到的 url 直接被攔下來變成 QR / 連結 / stdout。
describe('magicLinkOptions', () => {
  it('把 url 交給 capture callback，而不是寄出去', async () => {
    const captured: { email: string; url: string; token: string }[] = [];
    const opts = magicLinkOptions((d) => captured.push(d));

    await opts.sendMagicLink({ email: 'a@example.com', url: 'https://x/y?token=t', token: 't' });

    expect(captured).toEqual([{ email: 'a@example.com', url: 'https://x/y?token=t', token: 't' }]);
  });

  it('沒有 capture 時不炸 —— 大多數請求不需要連結', async () => {
    const opts = magicLinkOptions();
    await expect(
      opts.sendMagicLink({ email: 'a@example.com', url: 'u', token: 't' }),
    ).resolves.toBeUndefined();
  });

  // 連結被拿去建新帳號等於任何人都能自助註冊成使用者
  it('disableSignUp 為 true —— 連結只能用在既有帳號上', () => {
    expect(magicLinkOptions().disableSignUp).toBe(true);
  });

  // 櫃檯當場掃是主流程，但一定會有人說「我回家再用」
  it('效期夠長到能帶回家，但不是永久', () => {
    const seconds = magicLinkOptions().expiresIn;
    expect(seconds).toBeGreaterThanOrEqual(60 * 60);
    expect(seconds).toBeLessThanOrEqual(60 * 60 * 24);
  });
});

describe('createAuth 的 magic-link 接線', () => {
  const env = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    BETTER_AUTH_URL: 'https://api.example.com',
    WEB_URL: 'https://app.example.com',
    ALLOWED_ORIGINS: '',
    LINE_CLIENT_ID: '',
    LINE_CLIENT_SECRET: '',
  };

  it('掛上 magic-link plugin', () => {
    const auth = createAuth(env);
    const ids = (auth.options.plugins ?? []).map((p) => p.id);

    expect(ids).toContain('magic-link');
  });
});

// LINE 預設**不回傳 email** —— 要另外向 LINE 送審 Email address permission 才有。
// 而 better-auth 的 OAuth callback 在 `if (!userInfo.email)` 就直接 redirectOnError
// ("email_not_found")，跟資料庫欄位能不能為 NULL 無關。正式站實測到。
//
// 所以要合成一個佔位 email。這跟專案既有的做法一致：只有手機的家長用
// `0912345678@phone.internal`，那個 domain 不存在於公開網路。
describe('lineProfileToUser', () => {
  it('LINE 有給 email 就用真的', () => {
    expect(lineProfileToUser({ sub: 'U123', email: 'real@example.com' })).toEqual({
      email: 'real@example.com',
    });
  });

  it('沒給 email 就用 LINE user id 合成', () => {
    expect(lineProfileToUser({ sub: 'U123' })).toEqual({ email: 'U123@line.internal' });
  });

  // LINE 的欄位名在 id token 與 userinfo 端點之間不一致
  it('sub 不在時退回 userId', () => {
    expect(lineProfileToUser({ userId: 'U456' })).toEqual({ email: 'U456@line.internal' });
  });

  // 合成出 `undefined@line.internal` 的話，兩個不同的人會撞到同一個帳號 ——
  // 而 ba_user.email 是 UNIQUE，症狀會是「第二個人登入變成第一個人」
  it('連 id 都沒有時丟錯，不要合成出會相撞的 email', () => {
    expect(() => lineProfileToUser({})).toThrow(/id/i);
  });

  it('空字串的 email 當成沒有', () => {
    expect(lineProfileToUser({ sub: 'U789', email: '' })).toEqual({
      email: 'U789@line.internal',
    });
  });
});
