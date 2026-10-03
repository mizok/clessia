import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../../test-utils/multi-org-db';
import { publicOrgMiddleware } from '../../lib/public-org';
import { hashClientIp } from './application-common';
import enrollmentRoute from './enrollment-applications';
import trialRoute from './trial-applications';

/**
 * #1126：公開表單的防濫用。順序 honeypot → rate limit → CAPTCHA → 原本的驗證與寫入（便宜的先擋）。
 * - honeypot 有值：回 201 假 id、不寫（不讓機器人知道被擋）
 * - 同來源 1 小時 5 筆、同聯絡方式 24 小時同類 3 筆 → 429；計數存在自己的 DB（c12）
 * - Turnstile 可選：`TURNSTILE_SECRET_KEY` 有設才檢查；驗證服務打不通 → 503（fail-closed）
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
  opts: { route?: 'enrollment' | 'trial'; env?: Record<string, unknown>; ip?: string | null } = {},
) {
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
});

describe('rate limit', () => {
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

describe('CAPTCHA（Turnstile，可選）', () => {
  const withSecret = { TURNSTILE_SECRET_KEY: 'turnstile-secret' };

  it('沒設 secret：不檢查，也不打 siteverify', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect((await post(seed(), enrollmentBody())).res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('設了：沒帶 token → 400 CAPTCHA_FAILED，不寫', async () => {
    const db = seed();
    const { res, json } = await post(db, enrollmentBody(), { env: withSecret });

    expect(res.status).toBe(400);
    expect(json.code).toBe('CAPTCHA_FAILED');
    expect(written(db)).toHaveLength(0);
  });

  it('設了：siteverify 說不過 → 400；說過 → 201（帶 secret、token、remoteip）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
    vi.stubGlobal('fetch', fetchMock);

    expect(
      (await post(seed(), enrollmentBody({ captchaToken: 'bad' }), { env: withSecret })).json.code,
    ).toBe('CAPTCHA_FAILED');
    expect(
      (await post(seed(), enrollmentBody({ captchaToken: 'good' }), { env: withSecret })).res
        .status,
    ).toBe(201);
    const sent = fetchMock.mock.calls[1]![1].body as FormData;
    expect(sent.get('secret')).toBe('turnstile-secret');
    expect(sent.get('response')).toBe('good');
    expect(sent.get('remoteip')).toBe(IP);
  });

  it('siteverify 打不通 → 503 CAPTCHA_UNAVAILABLE（不放行），不寫', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const db = seed();
    const { res, json } = await post(db, enrollmentBody({ captchaToken: 'x' }), {
      env: withSecret,
    });

    expect(res.status).toBe(503);
    expect(json.code).toBe('CAPTCHA_UNAVAILABLE');
    expect(written(db)).toHaveLength(0);
  });
});
