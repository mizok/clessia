import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuth,
  googleProfileToUser,
  lineProfileToUser,
  magicLinkOptions,
  socialProvidersFromEnv,
} from './auth';

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
  // #2063：state 對不上等「讀到 errorCallbackURL 之前」的失敗，原本丟到 Better Auth 的 /error → 網站首頁
  it('OAuth 的 API 錯誤導回前端的登入頁（登入頁把 ?error= 翻成人話）', () => {
    const auth = createAuth({ ...baseEnv, BETTER_AUTH_URL: 'https://demo.clessia.cc' });
    expect(auth.options.onAPIError?.errorURL).toBe('https://app.example.com/login');
  });

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
  // better-auth 擋綁定的條件是 `!信任的provider && !emailVerified`。
  // 我們合成的 email 是從 OAuth 驗證過的 LINE user id 推導出來的 ——
  // **它的所有權由這條流程本身證明**，標成 verified 是誠實的。
  //
  // 反過來，真的 LINE email 我們無從驗證（也不知道 LINE 有沒有驗），維持 false。
  // 這比把整個 LINE 加進 trustedProviders 安全：那等於信任它給的任何 email，
  // 而 email 是可以拿來對上既有帳號的。
  it('LINE 有給 email 就用真的，且不宣稱已驗證', () => {
    expect(lineProfileToUser({ sub: 'U123', email: 'real@example.com' })).toEqual({
      email: 'real@example.com',
      emailVerified: false,
    });
  });

  it('合成的 email 標為已驗證 —— 否則 link-social 會被擋掉', () => {
    expect(lineProfileToUser({ sub: 'U123' })).toEqual({
      email: 'U123@line.internal',
      emailVerified: true,
    });
  });

  // LINE 的欄位名在 id token 與 userinfo 端點之間不一致
  it('sub 不在時退回 userId', () => {
    expect(lineProfileToUser({ userId: 'U456' })).toEqual({
      email: 'U456@line.internal',
      emailVerified: true,
    });
  });

  // 合成出 `undefined@line.internal` 的話，兩個不同的人會撞到同一個帳號 ——
  // 而 ba_user.email 是 UNIQUE，症狀會是「第二個人登入變成第一個人」
  it('連 id 都沒有時丟錯，不要合成出會相撞的 email', () => {
    expect(() => lineProfileToUser({})).toThrow(/id/i);
  });

  it('空字串的 email 當成沒有', () => {
    expect(lineProfileToUser({ sub: 'U789', email: '' })).toEqual({
      email: 'U789@line.internal',
      emailVerified: true,
    });
  });
});

// 綁定時 better-auth 比對「OAuth 回來的 email」與「目前 session 的 email」。
// 我們合成的 `U123@line.internal` 永遠不會等於使用者真正的 email，所以一定要放行，
// 否則 link-social 回 `email_doesn't_match`。正式站實測踩到。
describe('createAuth 允許不同 email 的帳號綁定', () => {
  const env = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    BETTER_AUTH_URL: 'https://demo.clessia.cc',
    WEB_URL: 'https://demo.clessia.cc',
    ALLOWED_ORIGINS: '',
    LINE_CLIENT_ID: 'cid',
    LINE_CLIENT_SECRET: 'secret',
  };

  it('allowDifferentEmails 為 true', () => {
    const auth = createAuth(env);
    const options = auth.options as unknown as {
      account?: { accountLinking?: { allowDifferentEmails?: boolean } };
    };

    expect(options.account?.accountLinking?.allowDifferentEmails).toBe(true);
  });

  // 第二道牆（#1842）：合成 email 已經讓隱式綁定對不上任何真人；哪天有人拿掉合成，
  // 「email 相同就自動綁上並登入」也不會發生。明確綁定（link-social）不看這個選項。
  it('關掉隱式綁定、不信任任何 provider 給的 email', () => {
    const auth = createAuth({ ...env, GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gs' });
    const options = auth.options as unknown as {
      account?: {
        accountLinking?: { disableImplicitLinking?: boolean; trustedProviders?: string[] };
      };
    };

    expect(options.account?.accountLinking?.disableImplicitLinking).toBe(true);
    expect(options.account?.accountLinking?.trustedProviders ?? []).toEqual([]);
  });

  // 這個選項的安全性**建立在合成的 email 有命名空間之上**。
  // 哪天有人把 @line.internal 拿掉、改用真的 email，帳號被奪取的風險就成真了。
  it('合成的 email 有專屬命名空間 —— 這是上面那個選項安全的前提', () => {
    expect(lineProfileToUser({ sub: 'U123' }).email).toMatch(/@line\.internal$/);
    expect(googleProfileToUser({ sub: '42' }).email).toMatch(/@google\.internal$/);
  });
});

// #1842（使用者 10-22 裁 A）：Google 跟 LINE 同一套 —— 不用 Google 的真 email，合成
// `<sub>@google.internal`。真 email 加上 Google 幾乎都是 true 的 email_verified，會讓
// better-auth 的隱式綁定把「email 剛好相同」的員工直接登入，跳過校方背書的綁定連結。
describe('googleProfileToUser', () => {
  it('一律合成 <sub>@google.internal 並標成已驗證', () => {
    expect(googleProfileToUser({ sub: '1234567890' })).toEqual({
      email: '1234567890@google.internal',
      emailVerified: true,
    });
  });

  it('Google 給了已驗證的真 email 也不用', () => {
    expect(
      googleProfileToUser({ sub: '42', email: 'alice@gmail.com', email_verified: true }),
    ).toEqual({ email: '42@google.internal', emailVerified: true });
  });

  // 合成出 `undefined@google.internal` 的話兩個不同的人會撞到同一個帳號（ba_user.email UNIQUE）
  it('沒有 sub 或 sub 是空字串就丟錯', () => {
    expect(() => googleProfileToUser({})).toThrow(/sub/);
    expect(() => googleProfileToUser({ sub: '' })).toThrow(/sub/);
  });
});

describe('socialProvidersFromEnv 的 google', () => {
  const both = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' };

  it('兩個變數都有才設定 google，少一個就沒有', () => {
    expect(Object.keys(socialProvidersFromEnv(both))).toEqual(['google']);
    expect(socialProvidersFromEnv({ ...both, GOOGLE_CLIENT_SECRET: '' })).toEqual({});
    expect(socialProvidersFromEnv({ ...both, GOOGLE_CLIENT_ID: '' })).toEqual({});
  });

  it('不能建帳號、只要 openid、讓使用者自己選帳號', () => {
    expect(socialProvidersFromEnv(both)['google']).toMatchObject({
      clientId: 'gid',
      clientSecret: 'gsecret',
      disableSignUp: true,
      disableDefaultScope: true,
      scope: ['openid'],
      prompt: 'select_account',
      mapProfileToUser: googleProfileToUser,
    });
  });

  it('LINE 與 Google 都設時兩個都在，LINE 的設定不受影響', () => {
    const providers = socialProvidersFromEnv({
      ...both,
      LINE_CLIENT_ID: 'cid',
      LINE_CLIENT_SECRET: 'secret',
    });
    expect(Object.keys(providers).sort()).toEqual(['google', 'line']);
    expect(providers['line']).toEqual(
      socialProvidersFromEnv({ LINE_CLIENT_ID: 'cid', LINE_CLIENT_SECRET: 'secret' })['line'],
    );
  });
});

// **idToken 入口不看 disableSignUp**（better-auth 1.5.5）：`sign-in.mjs` 的 idToken 分支讀
// `provider.disableSignUp`，但 `create-context.mjs` 建 provider 時只複製了 `disableImplicitSignUp`，
// `disableSignUp` 只在 `provider.options` 裡 —— 所以這條路**會建帳號**。Google 發得出
// `response_type=id_token`，知道 client id 的人都拿得到 aud 是我們的 id_token。
// 這裡用自己簽、驗得過的 id_token（JWKS 用 fetch 替身回），證明入口在驗簽那一步就被擋。
describe('Google 的 idToken 登入入口被關掉（#1842）', () => {
  afterEach(() => vi.unstubAllGlobals());

  function signedGoogleIdToken(aud: string) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64({
      iss: 'https://accounts.google.com',
      aud,
      sub: '1234567890',
      iat: now,
      exp: now + 600,
    })}`;
    const token = `${input}.${Buffer.from(sign('sha256', Buffer.from(input), privateKey)).toString('base64url')}`;
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ keys: [jwk] })),
    );
    return token;
  }

  it('POST /sign-in/social 帶 idToken → INVALID_TOKEN，走不到建帳號那一步', async () => {
    const auth = createAuth({
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/db',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'https://demo.clessia.cc',
      WEB_URL: 'https://demo.clessia.cc',
      ALLOWED_ORIGINS: '',
      LINE_CLIENT_ID: '',
      LINE_CLIENT_SECRET: '',
      GOOGLE_CLIENT_ID: 'gid',
      GOOGLE_CLIENT_SECRET: 'gsecret',
    });
    const token = signedGoogleIdToken('gid');

    await expect(
      auth.api.signInSocial({ body: { provider: 'google', idToken: { token } } }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_TOKEN' } });
  });
});

// 使用者 11-02：LINE 的 idToken 入口也關。理由同 Google（better-auth 1.5.5 那條路不看 disableSignUp）；
// LINE 要 channel secret 才換得到 id_token，難利用，但入口本身沒有用途，關掉比留著好。
describe('LINE 的 idToken 登入入口被關掉', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('provider 設定帶 disableIdTokenSignIn', () => {
    expect(
      socialProvidersFromEnv({ LINE_CLIENT_ID: 'cid', LINE_CLIENT_SECRET: 'secret' })['line'],
    ).toMatchObject({ disableIdTokenSignIn: true });
  });

  // LINE 的 verifyIdToken 打 LINE 的 verify 端點；替身讓它「驗得過」，證明擋下來的是這個旗標
  it('POST /sign-in/social 帶 idToken → INVALID_TOKEN，走不到建帳號那一步', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ aud: 'cid', sub: 'U123', iss: 'https://access.line.me' })),
    );
    const auth = createAuth({
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/db',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'https://demo.clessia.cc',
      WEB_URL: 'https://demo.clessia.cc',
      ALLOWED_ORIGINS: '',
      LINE_CLIENT_ID: 'cid',
      LINE_CLIENT_SECRET: 'secret',
    });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'U123', aud: 'cid' })}.sig`;

    await expect(
      auth.api.signInSocial({ body: { provider: 'line', idToken: { token } } }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_TOKEN' } });
  });
});
