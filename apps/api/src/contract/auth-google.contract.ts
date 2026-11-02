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
      LINE_CLIENT_ID: '',
      LINE_CLIENT_SECRET: '',
      GOOGLE_CLIENT_ID: 'contract-gid',
      GOOGLE_CLIENT_SECRET: 'contract-gsecret',
    },
    (p) => links.push(p),
  );
  const users: string[] = [];
  const realFetch = globalThis.fetch;

  /** Google 的 token 端點回這個人的 id_token；其他網址照常走（理論上不會有） */
  function googleReturns(claims: Record<string, unknown>) {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const idToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: 'https://accounts.google.com',
      aud: 'contract-gid',
      ...claims,
    })}.`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input instanceof Request ? input.url : input).startsWith(
          'https://oauth2.googleapis.com/token',
        )
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

  /** 走完「跳去 Google 再跳回來」：回 callback 最後導去的網址 */
  async function viaGoogle(
    b: Browser,
    path: '/api/auth/sign-in/social' | '/api/auth/link-social',
    sub: string,
    extra: Record<string, unknown> = {},
  ) {
    const start = await b(path, {
      body: {
        provider: 'google',
        callbackURL: `${WEB}/select-role`,
        errorCallbackURL: `${WEB}/login?provider=google`,
      },
    });
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get('state');
    googleReturns({ sub, ...extra });
    const back = await b(`/api/auth/callback/google?code=c&state=${state}`);
    return back.headers.get('location') ?? '';
  }

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

  it('只綁一個登入方式時不能解除（better-auth 內建，G-3 的前提）', async () => {
    const staff = await newUser();
    const { b } = await signedInAs(staff.email);
    await viaGoogle(b, '/api/auth/link-social', randomUUID());

    const res = await b('/api/auth/unlink-account', { body: { providerId: 'google' } });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' });
  });
});
