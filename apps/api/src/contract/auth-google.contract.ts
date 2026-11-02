import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuth, type MagicLinkPayload } from '../auth';

/**
 * #1842 Google 登入：對**本機 Postgres** 跑 better-auth 的真 handler，只有 Google 的 token 端點用 fetch 替身
 * （回一張自己組的 id_token；code flow 的 `getUserInfo` 只 `decodeJwt`、不驗簽）。
 * 守的是使用者 10-22 裁定 A 的幾條：不能建帳號、真 email 對不上既有帳號、只能經綁定連結綁上、
 * idToken 入口關著（better-auth 1.5.5 那條路不看 disableSignUp，見 auth.ts）。
 *
 * 帳號一律經 better-auth 自己的 API 建立與刪除（`createUser`／`internalAdapter.deleteUser`），不直寫 ba_*（c2）。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

const API = 'http://localhost:8787';
const WEB = 'http://localhost:4200';

run('Google 登入對真 Postgres（#1842）', () => {
  const links: MagicLinkPayload[] = [];
  const auth = createAuth(
    {
      DATABASE_URL: DB ?? '',
      BETTER_AUTH_SECRET: 'contract-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: API,
      WEB_URL: WEB,
      ALLOWED_ORIGINS: '',
      LINE_CLIENT_ID: 'contract-lid',
      LINE_CLIENT_SECRET: 'contract-lsecret',
      GOOGLE_CLIENT_ID: 'contract-gid',
      GOOGLE_CLIENT_SECRET: 'contract-gsecret',
    },
    (p) => links.push(p),
  );
  const users: string[] = [];
  const realFetch = globalThis.fetch;

  const TOKEN_ENDPOINT = {
    google: 'https://oauth2.googleapis.com/token',
    line: 'https://api.line.me/oauth2/v2.1/token',
  } as const;
  type Provider = keyof typeof TOKEN_ENDPOINT;

  /** provider 的 token 端點回這個人的 id_token；其他網址照常走（理論上不會有） */
  function providerReturns(provider: Provider, claims: Record<string, unknown>) {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const idToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: 'https://accounts.google.com',
      aud: 'contract-gid',
      ...claims,
    })}.`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input instanceof Request ? input.url : input).startsWith(TOKEN_ENDPOINT[provider])
          ? Response.json({
              access_token: 'at',
              id_token: idToken,
              token_type: 'Bearer',
              expires_in: 3600,
            })
          : realFetch(input, init),
      ),
    );
  }

  /** 一個瀏覽器：自己記 cookie */
  function browser() {
    const jar = new Map<string, string>();
    return async (path: string, init: { method?: string; body?: object } = {}) => {
      const res = await auth.handler(
        new Request(`${API}${path}`, {
          method: init.method ?? (init.body ? 'POST' : 'GET'),
          headers: {
            origin: WEB,
            cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
            ...(init.body ? { 'content-type': 'application/json' } : {}),
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
        }),
      );
      for (const line of res.headers.getSetCookie()) {
        const [pair = ''] = line.split(';');
        const at = pair.indexOf('=');
        const value = pair.slice(at + 1);
        if (value === '' || /max-age=0/i.test(line)) jar.delete(pair.slice(0, at));
        else jar.set(pair.slice(0, at), value);
      }
      return res;
    };
  }
  type Browser = ReturnType<typeof browser>;

  /** 走完「跳去 provider 再跳回來」：回 callback 最後導去的網址 */
  async function via(
    provider: Provider,
    b: Browser,
    path: '/api/auth/sign-in/social' | '/api/auth/link-social',
    sub: string,
    extra: Record<string, unknown> = {},
  ) {
    const start = await b(path, {
      body: {
        provider,
        callbackURL: `${WEB}/select-role`,
        errorCallbackURL: `${WEB}/login?provider=${provider}`,
      },
    });
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get('state');
    providerReturns(provider, { sub, ...extra });
    const back = await b(`/api/auth/callback/${provider}?code=c&state=${state}`);
    return back.headers.get('location') ?? '';
  }

  const viaGoogle = (
    b: Browser,
    path: '/api/auth/sign-in/social' | '/api/auth/link-social',
    sub: string,
    extra: Record<string, unknown> = {},
  ) => via('google', b, path, sub, extra);

  const sessionUser = async (b: Browser) =>
    ((await (await b('/api/auth/get-session')).json()) as { user?: { id: string } } | null)?.user
      ?.id;

  async function newUser(email = `c1842-${randomUUID()}@phone.internal`) {
    const { user } = (await auth.api.createUser({ body: { email, name: 'c1842' } })) as {
      user: { id: string };
    };
    users.push(user.id);
    return { id: user.id, email };
  }

  /** 拿一次性連結兌換 session（綁定流程的第一步） */
  async function signedInAs(email: string) {
    await auth.api.signInMagicLink({
      body: { email, callbackURL: `${WEB}/link-line` },
      headers: new Headers(),
    });
    const link = links.at(-1)!.url;
    const b = browser();
    await b(new URL(link).pathname + new URL(link).search);
    return { b, link };
  }

  const counts = async () =>
    (
      await auth.pool.query<{ users: string; accounts: string }>(
        `SELECT (SELECT count(*) FROM ba_user) AS users,
                (SELECT count(*) FROM ba_account WHERE "providerId" = 'google') AS accounts`,
      )
    ).rows[0];

  beforeAll(async () => {
    await auth.pool.query('SELECT 1');
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    const ctx = await auth.$context;
    for (const id of users) await ctx.internalAdapter.deleteUser(id);
    await auth.pool.end();
  });

  it('沒綁過的 Google 帳號：不建帳號，回登入頁帶 signup_disabled', async () => {
    const before = await counts();

    const location = await viaGoogle(browser(), '/api/auth/sign-in/social', randomUUID());

    expect(location).toBe(`${WEB}/login?provider=google&error=signup_disabled`);
    expect(await counts()).toEqual(before);
  });

  it('Google 給的真 email 跟既有帳號一樣：也不會對上、不會登入', async () => {
    const alice = await newUser(`c1842-${randomUUID()}@gmail.com`);
    const before = await counts();
    const b = browser();

    const location = await viaGoogle(b, '/api/auth/sign-in/social', randomUUID(), {
      email: alice.email,
      email_verified: true,
    });

    expect(location).toContain('error=signup_disabled');
    expect(await sessionUser(b)).toBeUndefined();
    expect(await counts()).toEqual(before);
  });

  // 第二道牆 disableImplicitLinking 自己的測試（#2165 二讀建議）：合成 email 讓真 email 那條永遠對不上，
  // 所以要測它就得讓 email 真的對上 —— ba_user 裡已經有人的 email 剛好就是 `<sub>@google.internal`、
  // 但沒有綁這個 Google 帳號。拿掉 disableImplicitLinking 的話，這裡會被「同 email 自動綁上並登入」。
  it('email 對上但沒綁（隱式綁定）：不登入、不建 ba_account', async () => {
    const sub = randomUUID();
    await newUser(`${sub}@google.internal`);
    const before = await counts();
    const b = browser();

    const location = await viaGoogle(b, '/api/auth/sign-in/social', sub);

    expect(location).toContain('error=account_not_linked');
    expect(await sessionUser(b)).toBeUndefined();
    expect(await counts()).toEqual(before);
  });

  it('綁定連結 → 綁 Google → 換個瀏覽器用 Google 登入 → 登進同一個人', async () => {
    const staff = await newUser();
    const sub = randomUUID();
    const { b } = await signedInAs(staff.email);
    expect(await sessionUser(b)).toBe(staff.id);

    expect(await viaGoogle(b, '/api/auth/link-social', sub)).toBe(`${WEB}/select-role`);

    const fresh = browser();
    expect(await viaGoogle(fresh, '/api/auth/sign-in/social', sub)).toBe(`${WEB}/select-role`);
    expect(await sessionUser(fresh)).toBe(staff.id);
  });

  it('已經綁給別人的 Google 帳號不能再綁', async () => {
    const sub = randomUUID();
    const first = await newUser();
    await viaGoogle((await signedInAs(first.email)).b, '/api/auth/link-social', sub);

    const second = await newUser();
    const location = await viaGoogle(
      (await signedInAs(second.email)).b,
      '/api/auth/link-social',
      sub,
    );

    expect(location).toContain('error=account_already_linked_to_different_user');
  });

  it('綁定連結只能用一次', async () => {
    const staff = await newUser();
    const { link } = await signedInAs(staff.email);

    const again = browser();
    await again(new URL(link).pathname + new URL(link).search);

    expect(await sessionUser(again)).toBeUndefined();
  });

  it('idToken 入口關著：拿 id_token 直接登入被拒，不建帳號', async () => {
    const before = await counts();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({ sub: randomUUID(), aud: 'contract-gid' })}.`;

    const res = await browser()('/api/auth/sign-in/social', {
      body: { provider: 'google', idToken: { token } },
    });

    expect(res.status).toBe(401);
    expect(await counts()).toEqual(before);
  });

  // 使用者 11-02：LINE 的 idToken 入口也關。LINE 的 verify 端點用替身「驗得過」，擋下來的只能是 disableIdTokenSignIn
  it('LINE 帶 idToken 走 sign-in/social 被拒，不建帳號', async () => {
    const lineRows = async () =>
      (
        await auth.pool.query<{ users: string; line: string }>(
          `SELECT (SELECT count(*) FROM ba_user) AS users,
                  (SELECT count(*) FROM ba_account WHERE "providerId" = 'line') AS line`,
        )
      ).rows[0];
    const before = await lineRows();
    const sub = `U${randomUUID().replace(/-/g, '')}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input instanceof Request ? input.url : input).startsWith(
          'https://api.line.me/oauth2/v2.1/verify',
        )
          ? Response.json({ aud: 'contract-lid', sub, iss: 'https://access.line.me' })
          : realFetch(input, init),
      ),
    );
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'HS256' })}.${b64({ sub, aud: 'contract-lid' })}.sig`;

    const res = await browser()('/api/auth/sign-in/social', {
      body: { provider: 'line', idToken: { token } },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await lineRows()).toEqual(before);
  });

  it('只綁一個登入方式時不能解除（better-auth 內建，G-3 的前提）', async () => {
    const staff = await newUser();
    const { b } = await signedInAs(staff.email);
    await viaGoogle(b, '/api/auth/link-social', randomUUID());

    const res = await b('/api/auth/unlink-account', { body: { providerId: 'google' } });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' });
  });

  // G-3（使用者 11-02：綁兩個以上才給解除）：伺服器端擋最後一個，前端只是不畫按鈕
  it('綁 LINE＋Google：能解掉一個、剩下的照常登入；解最後一個被擋', async () => {
    const staff = await newUser();
    const lineSub = `U${randomUUID().replace(/-/g, '')}`;
    const googleSub = randomUUID();
    const { b } = await signedInAs(staff.email);
    await via('line', b, '/api/auth/link-social', lineSub);
    await viaGoogle(b, '/api/auth/link-social', googleSub);
    const providersOf = async () =>
      ((await (await b('/api/auth/list-accounts')).json()) as { providerId: string }[])
        .map((a) => a.providerId)
        .sort();
    expect(await providersOf()).toEqual(['google', 'line']);

    const unlinkGoogle = await b('/api/auth/unlink-account', { body: { providerId: 'google' } });
    expect(unlinkGoogle.status).toBe(200);
    expect(await providersOf()).toEqual(['line']);

    // 解掉的 Google 不能再登入（帳號不存在、也不能建）；LINE 照常登入同一個人
    expect(await viaGoogle(browser(), '/api/auth/sign-in/social', googleSub)).toContain(
      'error=signup_disabled',
    );
    const fresh = browser();
    expect(await via('line', fresh, '/api/auth/sign-in/social', lineSub)).toBe(
      `${WEB}/select-role`,
    );
    expect(await sessionUser(fresh)).toBe(staff.id);

    const unlinkLast = await b('/api/auth/unlink-account', { body: { providerId: 'line' } });
    expect(unlinkLast.status).toBe(400);
    expect(await unlinkLast.json()).toMatchObject({ code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' });
    expect(await providersOf()).toEqual(['line']);
  });

  // disableImplicitLinking 是全域設定，LINE 也吃到。它只在「找到同 email、但**沒綁**這個 provider」時才擋
  // （`oauth2/link-account.mjs:19-28` 的 `if (!linkedAccount)`）；LINE 現有使用者都是經綁定連結綁好的帳號，
  // 走的是 linkedAccount 那條，不受影響。
  it('已綁 LINE 的人照常用 LINE 登入（全域 disableImplicitLinking 不影響既有綁定）', async () => {
    const parent = await newUser();
    const sub = `U${randomUUID().replace(/-/g, '')}`;
    const { b } = await signedInAs(parent.email);
    expect(await via('line', b, '/api/auth/link-social', sub)).toBe(`${WEB}/select-role`);

    const fresh = browser();
    expect(await via('line', fresh, '/api/auth/sign-in/social', sub)).toBe(`${WEB}/select-role`);
    expect(await sessionUser(fresh)).toBe(parent.id);
  });
});
