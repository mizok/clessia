import { verifySolution } from 'altcha-lib';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { altchaPayload } from '../../test-utils/altcha-payload';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { publicOrgMiddleware } from '../../lib/public-org';
import { hashClientIp } from './application-common';
import captchaRoute from './captcha';
import enrollmentRoute from './enrollment-applications';
import trialRoute from './trial-applications';

// 照原樣跑，只是看得到有沒有被呼叫（「限速在機器人驗證之前」那條要它）
vi.mock('altcha-lib', async (importOriginal) => {
  const orig = await importOriginal<typeof import('altcha-lib')>();
  return { ...orig, verifySolution: vi.fn(orig.verifySolution) };
});

/**
 * #1126：公開表單的防濫用。順序 honeypot → rate limit → CAPTCHA → 原本的驗證與寫入（便宜的先擋）。
 * - honeypot 有值：回 201 假 id、不寫（不讓機器人知道被擋）
 * - 同來源 1 小時 5 筆、同聯絡方式 24 小時同類 3 筆 → 429；計數存在自己的 DB（c12）
 * - 機器人驗證（#1665）：預設 ALTCHA；`CAPTCHA_PROVIDER=turnstile` 改走 Turnstile；
 *   **兩種都不能被略過** —— 沒帶、驗不過 → 400，設定不完整或驗證服務打不通 → 503（fail-closed）
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const CLASS = '00000000-0000-0000-0000-000000000011';
const COURSE = '00000000-0000-0000-0000-000000000021';
const SECRET = 'test-secret';
const IP = '203.0.113.7';
const NOW = '2026-10-04T04:00:00Z';
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

function seed(existing: Array<Record<string, unknown>> = []) {
  return createMultiOrgDb({
    organizations: [{ id: ORG, slug: 'demo' }],
    classes: [
      {
        id: CLASS,
        org_id: ORG,
        course_id: COURSE,
        max_students: 20,
        is_active: true,
        end_date: null,
        is_public_enrollment: true,
        courses: { is_active: true },
      },
    ],
    enrollments: [],
    public_applications: existing.map((row, i) => ({
      id: `existing-${i}`,
      org_id: ORG,
      kind: 'enrollment',
      parent_phone: null,
      parent_email: null,
      client_ip_hash: null,
      created_at: ago(1),
      ...row,
    })),
    public_application_targets: [],
  });
}

const enrollmentBody = (extra: Record<string, unknown> = {}) => ({
  parent: { name: '王媽媽', phone: '0912345678', relation: 'mother' },
  student: { name: '王小明', grade: 'J2', school: '信義國中' },
  classIds: [CLASS],
  consent: true,
  ...extra,
});

async function post(
  db: ReturnType<typeof seed>,
  payload: unknown,
  opts: {
    route?: 'enrollment' | 'trial';
    env?: Record<string, unknown>;
    ip?: string | null;
    /** 預設自動附一份有效的 ALTCHA 解答；false＝不附 */
    captcha?: false;
  } = {},
) {
  if (opts.captcha !== false && !(payload as { captchaToken?: string }).captchaToken) {
    payload = { ...(payload as object), captchaToken: await altchaPayload() };
  }
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('supabase', db.client);
    await next();
  });
  app.use('*', publicOrgMiddleware);
  app.route('/', (opts.route === 'trial' ? trialRoute : enrollmentRoute) as unknown as Hono);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.ip !== null) headers['cf-connecting-ip'] = opts.ip ?? IP;
  const res = await app.request(
    '/',
    { method: 'POST', headers, body: JSON.stringify(payload) },
    { PUBLIC_ORG_SLUG: 'demo', BETTER_AUTH_SECRET: SECRET, ...opts.env },
  );
  return { res, json: (await res.json()) as any };
}

const written = (db: ReturnType<typeof seed>) =>
  db.rows('public_applications').filter((r) => !String(r['id']).startsWith('existing-'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('honeypot', () => {
  it('website 有值：201 假 id，兩張表都沒寫', async () => {
    const db = seed();
    const { res, json } = await post(db, enrollmentBody({ website: 'http://spam.example' }));

    expect(res.status).toBe(201);
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(written(db)).toHaveLength(0);
    expect(db.rows('public_application_targets')).toHaveLength(0);
  });

  it('試聽端點同樣：201 假 id，兩張表都沒寫', async () => {
    const db = seed();
    const { res, json } = await post(
      db,
      {
        parent: { name: '林爸爸', phone: '0912345678', relation: 'father' },
        student: { name: '林小美', grade: 'P5', school: '信義國小' },
        courseIds: [COURSE],
        consent: true,
        website: 'http://spam.example',
      },
      { route: 'trial' },
    );

    expect(res.status).toBe(201);
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(written(db)).toHaveLength(0);
    expect(db.rows('public_application_targets')).toHaveLength(0);
  });
});

describe('rate limit', () => {
  // 便宜的先擋（#1126 的順序 honeypot → rate limit → CAPTCHA）：被限速的人不必、也不該先跑一次驗證。
  // 「帶錯」用簽章不符的 payload —— 格式壞掉的在呼叫 verifySolution 之前就被拒，順序調換也看不出來
  it('限速在機器人驗證之前：同來源第 6 筆，沒帶或帶錯 token 都回 429（不是 400），也沒去驗', async () => {
    const hash = await hashClientIp(IP, SECRET);
    const recent = Array.from({ length: 5 }, (_, i) => ({
      client_ip_hash: hash,
      parent_phone: `09000000${10 + i}`,
    }));
    const wrong = await altchaPayload({ secret: 'someone-else' });

    for (const token of [undefined, wrong]) {
      vi.mocked(verifySolution).mockClear();
      const db = seed(recent);
      const { res, json } = await post(
        db,
        enrollmentBody(token ? { captchaToken: token } : {}),
        token ? {} : { captcha: false },
      );

      expect(res.status, token ? '帶錯' : '沒帶').toBe(429);
      expect(json.code).toBe('RATE_LIMITED');
      expect(verifySolution).not.toHaveBeenCalled();
      expect(written(db)).toHaveLength(0);
    }
  });

  it('寫入時存的是 IP 的 HMAC，不是原始 IP', async () => {
    const db = seed();
    await post(db, enrollmentBody());

    const hash = await hashClientIp(IP, SECRET);
    expect(written(db)[0]!['client_ip_hash']).toBe(hash);
    expect(hash).not.toContain(IP);
  });

  it('同來源 1 小時內第 6 筆：429 RATE_LIMITED＋Retry-After，不寫；超過 1 小時的不算', async () => {
    const hash = await hashClientIp(IP, SECRET);
    const recent = Array.from({ length: 5 }, (_, i) => ({
      client_ip_hash: hash,
      parent_phone: `09000000${10 + i}`,
    }));

    const blocked = seed(recent);
    const { res, json } = await post(blocked, enrollmentBody());
    expect(res.status).toBe(429);
    expect(json.code).toBe('RATE_LIMITED');
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(written(blocked)).toHaveLength(0);

    const old = seed(recent.map((r) => ({ ...r, created_at: ago(61) })));
    expect((await post(old, enrollmentBody())).res.status).toBe(201);
  });

  it('同手機 24 小時內同類第 4 筆：429；換手機可過；試聽不算進報名', async () => {
    const samePhone = Array.from({ length: 3 }, () => ({ parent_phone: '0912345678' }));

    expect((await post(seed(samePhone), enrollmentBody(), { ip: null })).res.status).toBe(429);
    expect(
      (
        await post(
          seed(samePhone),
          enrollmentBody({ parent: { name: '王媽媽', phone: '0987654321', relation: 'mother' } }),
          { ip: null },
        )
      ).res.status,
    ).toBe(201);
    expect(
      (
        await post(seed(samePhone.map((r) => ({ ...r, kind: 'trial' }))), enrollmentBody(), {
          ip: null,
        })
      ).res.status,
    ).toBe(201);
  });

  it('計數查詢出錯：503 RATE_LIMIT_UNAVAILABLE，不吞成 0 放行、不寫', async () => {
    const db = seed();
    // 只讓「數筆數」那支（head: true）回 error；寫入照常 —— 修前它會被當成 0 筆而寫進去
    const failing: any = new Proxy(
      {},
      {
        get: (_, p) =>
          p === 'then'
            ? (resolve: (v: unknown) => void) =>
                resolve({ data: null, count: null, error: { message: 'boom' } })
            : () => failing,
      },
    );
    const client = new Proxy(db.client as any, {
      get(target, prop) {
        if (prop !== 'from') return Reflect.get(target, prop);
        return (table: string) => {
          const builder = target.from(table);
          if (table !== 'public_applications') return builder;
          return new Proxy(builder, {
            get(b, p) {
              if (p === 'select')
                return (cols: string, o?: { head?: boolean }) =>
                  o?.head ? failing : b.select(cols, o);
              const v = Reflect.get(b, p);
              return typeof v === 'function' ? v.bind(b) : v;
            },
          });
        };
      },
    });

    for (const ip of [IP, null]) {
      const { res, json } = await post({ ...db, client } as typeof db, enrollmentBody(), { ip });
      expect(res.status).toBe(503);
      expect(json.code).toBe('RATE_LIMIT_UNAVAILABLE');
    }
    expect(written(db)).toHaveLength(0);
  });

  // #1335（使用者 10-23 裁）：寫入轉小寫、比對不分大小寫；舊資料不 backfill，比對端接住
  const trialBody = (email: string) => ({
    parent: { name: '林爸爸', email, relation: 'father' },
    student: { name: '林小美', grade: 'P5', school: '信義國小' },
    courseIds: [COURSE],
    consent: true,
  });
  const existingTrials = (email: string) =>
    Array.from({ length: 3 }, () => ({ kind: 'trial', parent_email: email }));

  it('同 Email 換大小寫也算同一個聯絡方式：舊資料是大寫、這次小寫 → 第 4 筆 429', async () => {
    const { res } = await post(
      seed(existingTrials('A@Example.Test')),
      trialBody('a@example.test'),
      {
        route: 'trial',
        ip: null,
      },
    );
    expect(res.status).toBe(429);
  });

  it('這次送大寫 → 一樣 429；寫進去的 Email 是小寫', async () => {
    const blocked = await post(
      seed(existingTrials('a@example.test')),
      trialBody('A@EXAMPLE.TEST'),
      {
        route: 'trial',
        ip: null,
      },
    );
    expect(blocked.res.status).toBe(429);

    const db = seed();
    const ok = await post(db, trialBody('  New@Example.TEST '), { route: 'trial', ip: null });
    expect(ok.res.status).toBe(201);
    expect(written(db).map((r) => r['parent_email'])).toEqual(['new@example.test']);
  });

  it('Email 裡的 _ 與 % 不是萬用字元：a_b@ 不會把 axb@ 算進來', async () => {
    const { res } = await post(
      seed(existingTrials('axb@example.test')),
      trialBody('a_b@example.test'),
      {
        route: 'trial',
        ip: null,
      },
    );
    expect(res.status).toBe(201);
  });

  it('試聽端點走同一套（同 Email 第 4 筆 429）', async () => {
    const sameEmail = Array.from({ length: 3 }, () => ({
      kind: 'trial',
      parent_email: 'a@example.test',
    }));
    const { res } = await post(
      seed(sameEmail),
      {
        parent: { name: '林爸爸', email: 'a@example.test', relation: 'father' },
        student: { name: '林小美', grade: 'P5', school: '信義國小' },
        courseIds: [COURSE],
        consent: true,
      },
      { route: 'trial', ip: null },
    );

    expect(res.status).toBe(429);
  });
});

describe('機器人驗證：預設 ALTCHA', () => {
  it('沒設 CAPTCHA_PROVIDER：沒帶解答 → 400 CAPTCHA_FAILED，不寫、不連外', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const db = seed();
    const { res, json } = await post(db, enrollmentBody(), { captcha: false });

    expect(res.status).toBe(400);
    expect(json.code).toBe('CAPTCHA_FAILED');
    expect(written(db)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('正確的解答通過 → 201，且沒有打任何外部服務（c12）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const db = seed();
    const { res } = await post(db, enrollmentBody({ captchaToken: await altchaPayload() }));

    expect(res.status).toBe(201);
    expect(written(db)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('過期的解答被拒 → 400，不寫', async () => {
    const db = seed();
    const expired = await altchaPayload({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    const { res, json } = await post(db, enrollmentBody({ captchaToken: expired }));

    expect(res.status).toBe(400);
    expect(json.code).toBe('CAPTCHA_FAILED');
    expect(written(db)).toHaveLength(0);
  });

  it('簽章不符被拒：別的金鑰簽的、或題目被改過 → 400', async () => {
    for (const token of [
      await altchaPayload({ secret: 'someone-else' }),
      await altchaPayload({ tamper: true }),
    ]) {
      const db = seed();
      const { res, json } = await post(db, enrollmentBody({ captchaToken: token }));
      expect(res.status).toBe(400);
      expect(json.code).toBe('CAPTCHA_FAILED');
      expect(written(db)).toHaveLength(0);
    }
  });

  it('格式壞掉的 payload（含 widget test 模式的 challenge: null）→ 400', async () => {
    for (const token of [
      'not-base64!!',
      btoa('{"x":1}'),
      btoa(JSON.stringify({ challenge: null, solution: null, test: true })),
    ]) {
      const { json } = await post(seed(), enrollmentBody({ captchaToken: token }));
      expect(json.code).toBe('CAPTCHA_FAILED');
    }
  });

  it('設了 ALTCHA_HMAC_KEY：用它簽，BETTER_AUTH_SECRET 衍生的那把就不認', async () => {
    const env = { ALTCHA_HMAC_KEY: 'dedicated-key' };
    const viaDedicated = await altchaPayload({ hmacKey: 'dedicated-key' });
    expect(
      (await post(seed(), enrollmentBody({ captchaToken: viaDedicated }), { env })).res.status,
    ).toBe(201);
    expect(
      (await post(seed(), enrollmentBody({ captchaToken: await altchaPayload() }), { env })).json
        .code,
    ).toBe('CAPTCHA_FAILED');
  });

  it('不認得的 CAPTCHA_PROVIDER → 503，不退回不驗', async () => {
    const db = seed();
    const { res, json } = await post(db, enrollmentBody(), { env: { CAPTCHA_PROVIDER: 'none' } });

    expect(res.status).toBe(503);
    expect(json.code).toBe('CAPTCHA_UNAVAILABLE');
    expect(written(db)).toHaveLength(0);
  });

  it('試聽端點走同一套：沒帶解答 → 400', async () => {
    const { json } = await post(
      seed(),
      {
        parent: { name: '林爸爸', phone: '0912345678', relation: 'father' },
        student: { name: '林小美', grade: 'P5', school: '信義國小' },
        courseIds: [COURSE],
        consent: true,
      },
      { route: 'trial', captcha: false },
    );
    expect(json.code).toBe('CAPTCHA_FAILED');
  });
});

describe('機器人驗證：CAPTCHA_PROVIDER=turnstile', () => {
  const turnstile = { CAPTCHA_PROVIDER: 'turnstile', TURNSTILE_SECRET_KEY: 'turnstile-secret' };

  it('沒設 TURNSTILE_SECRET_KEY → 503 拒收（不退回不驗）', async () => {
    const db = seed();
    const { res, json } = await post(db, enrollmentBody({ captchaToken: 'x' }), {
      env: { CAPTCHA_PROVIDER: 'turnstile' },
    });

    expect(res.status).toBe(503);
    expect(json.code).toBe('CAPTCHA_UNAVAILABLE');
    expect(written(db)).toHaveLength(0);
  });

  it('沒帶 token → 400 CAPTCHA_FAILED，不寫', async () => {
    const db = seed();
    const { res, json } = await post(db, enrollmentBody(), { env: turnstile, captcha: false });

    expect(res.status).toBe(400);
    expect(json.code).toBe('CAPTCHA_FAILED');
    expect(written(db)).toHaveLength(0);
  });

  it('ALTCHA 的解答在 turnstile 模式不算數（交給 siteverify 判，說不過 → 400）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }))),
    );
    const { json } = await post(seed(), enrollmentBody({ captchaToken: await altchaPayload() }), {
      env: turnstile,
    });
    expect(json.code).toBe('CAPTCHA_FAILED');
  });

  it('siteverify 說不過 → 400；說過 → 201（帶 secret、token、remoteip）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      (await post(seed(), enrollmentBody({ captchaToken: 'bad' }), { env: turnstile })).json.code,
    ).toBe('CAPTCHA_FAILED');
    expect(
      (await post(seed(), enrollmentBody({ captchaToken: 'good' }), { env: turnstile })).res.status,
    ).toBe(201);
    const sent = fetchMock.mock.calls[1]![1].body as FormData;
    expect(sent.get('secret')).toBe('turnstile-secret');
    expect(sent.get('response')).toBe('good');
    expect(sent.get('remoteip')).toBe(IP);
  });

  it('siteverify 打不通 → 503 CAPTCHA_UNAVAILABLE（不放行），不寫', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const db = seed();
    const { res, json } = await post(db, enrollmentBody({ captchaToken: 'x' }), { env: turnstile });

    expect(res.status).toBe(503);
    expect(json.code).toBe('CAPTCHA_UNAVAILABLE');
    expect(written(db)).toHaveLength(0);
  });
});

describe('GET /api/public/captcha', () => {
  async function get(env: Record<string, unknown> = {}) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const db = seed();
      (c as unknown as { set: (k: string, v: unknown) => void }).set('supabase', db.client);
      await next();
    });
    app.use('*', publicOrgMiddleware);
    app.route('/', captchaRoute as unknown as Hono);
    const res = await app.request(
      '/',
      {},
      { PUBLIC_ORG_SLUG: 'demo', BETTER_AUTH_SECRET: SECRET, ...env },
    );
    return { res, json: (await res.json()) as any };
  }

  it('預設：回一道簽過、10 分鐘後過期的 ALTCHA 題目，不給快取', async () => {
    const { res, json } = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(json.provider).toBe('altcha');
    expect(json.challenge.parameters.algorithm).toBe('PBKDF2/SHA-256');
    expect(json.challenge.parameters.expiresAt).toBe(Math.floor(Date.now() / 1000) + 600);
    expect(json.challenge.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(json.challenge.parameters.keySignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('turnstile：回 site key；缺 site key 或 secret → 503', async () => {
    const full = {
      CAPTCHA_PROVIDER: 'turnstile',
      TURNSTILE_SECRET_KEY: 's',
      TURNSTILE_SITE_KEY: 'site-1',
    };
    expect((await get(full)).json).toEqual({ provider: 'turnstile', siteKey: 'site-1' });
    expect((await get({ ...full, TURNSTILE_SITE_KEY: '' })).res.status).toBe(503);
    expect((await get({ ...full, TURNSTILE_SECRET_KEY: '' })).res.status).toBe(503);
  });

  it('不認得的 provider → 503', async () => {
    expect((await get({ CAPTCHA_PROVIDER: 'hcaptcha' })).res.status).toBe(503);
  });
});
