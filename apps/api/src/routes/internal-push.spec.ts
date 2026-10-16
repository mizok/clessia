import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runPush = vi.hoisted(() => vi.fn());
vi.mock('../lib/push-run', () => ({ runPush, DEFAULT_PUSH_BATCH_SIZE: 10 }));

import internalPushRoute, { secretMatches } from './internal-push';

/**
 * #1661：`/api/internal/push/run` 唯一的門是 CRON_SECRET。排程本身（排入、送出、去重）在
 * `lib/push-run.spec.ts` 與 `contract/push-run.contract.ts`。
 */

const ENV = {
  CRON_SECRET: 's3cret',
  VAPID_PUBLIC_KEY: 'BPUB',
  VAPID_PRIVATE_KEY: 'priv',
  VAPID_SUBJECT: 'mailto:ops@example.com',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x', // 不會真的連：runPush 是替身
};

function call(env: Record<string, string>, authorization?: string) {
  const app = new Hono();
  app.route('/', internalPushRoute as unknown as Hono);
  return app.request(
    '/run',
    { method: 'POST', headers: authorization ? { authorization } : {} },
    env,
  );
}

describe('POST /api/internal/push/run 的門（#1661）', () => {
  afterEach(() => runPush.mockReset());

  it('沒設 CRON_SECRET → 404，不跑', async () => {
    const { CRON_SECRET: _omit, ...env } = ENV;
    expect((await call(env, 'Bearer s3cret')).status).toBe(404);
    expect(runPush).not.toHaveBeenCalled();
  });

  it.each([
    ['沒帶', undefined],
    ['帶錯', 'Bearer wrong'],
    ['少了 Bearer', 's3cret'],
  ])('%s → 401，不跑', async (_l, auth) => {
    expect((await call(ENV, auth)).status).toBe(401);
    expect(runPush).not.toHaveBeenCalled();
  });

  it('對 → 200，用台北今天、預設批量 10 與 VAPID 跑一次', async () => {
    runPush.mockResolvedValue({
      enqueued: 1,
      attempted: 1,
      delivered: 1,
      removedSubscriptions: 0,
      purged: 0,
    });
    const res = await call(ENV, 'Bearer s3cret');
    expect(res.status).toBe(200);
    expect(runPush).toHaveBeenCalledWith(expect.anything(), {
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      batchSize: 10,
      vapid: { publicKey: 'BPUB', privateKey: 'priv' },
      subject: 'mailto:ops@example.com',
    });
  });

  it('PUSH_BATCH_SIZE 可以調', async () => {
    runPush.mockResolvedValue({});
    await call({ ...ENV, PUSH_BATCH_SIZE: '25' }, 'Bearer s3cret');
    expect(runPush.mock.calls[0]![1]).toMatchObject({ batchSize: 25 });
  });

  it('VAPID 沒設齊 → 500 PUSH_NOT_CONFIGURED，不跑', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call({ ...ENV, VAPID_PRIVATE_KEY: '' }, 'Bearer s3cret');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'PUSH_NOT_CONFIGURED' });
    expect(runPush).not.toHaveBeenCalled();
  });

  it('run 丟例外 → 500，不是 200', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runPush.mockRejectedValue(new Error('boom'));
    expect((await call(ENV, 'Bearer s3cret')).status).toBe(500);
  });
});

describe('secretMatches', () => {
  it('相同才是 true；長度不同、差一個字都 false', async () => {
    expect(await secretMatches('Bearer a', 'Bearer a')).toBe(true);
    expect(await secretMatches('Bearer a', 'Bearer b')).toBe(false);
    expect(await secretMatches('Bearer ab', 'Bearer a')).toBe(false);
    expect(await secretMatches('', 'Bearer a')).toBe(false);
  });
});
