import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Pool } from 'pg';

import { authPoolCleanup, getAuth } from './get-auth';
import type { AppEnv } from '../index';

const testEnv = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:54322/postgres',
  BETTER_AUTH_SECRET: 'test-secret',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_URL: 'http://localhost:4200',
  ALLOWED_ORIGINS: '',
  LINE_CLIENT_ID: '',
  LINE_CLIENT_SECRET: '',
};

/** Workers 的 ExecutionContext 替身，只要 waitUntil 被叫到就算數 */
function fakeExecutionCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext & { waitUntil: ReturnType<typeof vi.fn> };
}

describe('getAuth', () => {
  it('同一個請求裡呼叫兩次，拿到同一個實例（同一個連線池）', async () => {
    const app = new Hono<AppEnv>();
    let first: unknown;
    let second: unknown;

    app.get('/', (c) => {
      first = getAuth(c);
      second = getAuth(c);
      return c.text('ok');
    });

    await app.request('http://localhost/', {}, testEnv, fakeExecutionCtx());

    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it('不同請求之間不共用實例 —— Workers 不允許跨請求用 I/O 物件', async () => {
    const app = new Hono<AppEnv>();
    const seen: unknown[] = [];

    app.get('/', (c) => {
      seen.push(getAuth(c));
      return c.text('ok');
    });

    await app.request('http://localhost/', {}, testEnv, fakeExecutionCtx());
    await app.request('http://localhost/', {}, testEnv, fakeExecutionCtx());

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe('authPoolCleanup', () => {
  it('回應之後把池關掉，並把關閉的 promise 交給 waitUntil', async () => {
    const app = new Hono<AppEnv>();
    let pool: Pool | undefined;

    app.use('*', authPoolCleanup);
    app.get('/', (c) => {
      pool = getAuth(c).pool;
      return c.text('ok');
    });

    const ctx = fakeExecutionCtx();
    const response = await app.request('http://localhost/', {}, testEnv, ctx);

    expect(response.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(pool?.ending).toBe(true);
  });

  // app.request() 不帶 executionCtx 時 `c.executionCtx` 會丟例外。測試環境與部分本機
  // 情境都長這樣，退化路徑不能把請求弄炸。
  it('沒有 executionCtx 時不炸，而且照樣把池關掉', async () => {
    const app = new Hono<AppEnv>();
    let pool: Pool | undefined;

    app.use('*', authPoolCleanup);
    app.get('/', (c) => {
      pool = getAuth(c).pool;
      return c.text('ok');
    });

    const response = await app.request('http://localhost/', {}, testEnv);

    expect(response.status).toBe(200);
    expect(pool?.ending).toBe(true);
  });

  it('沒有人呼叫 getAuth 的請求不建池、也不註冊收尾', async () => {
    const app = new Hono<AppEnv>();

    app.use('*', authPoolCleanup);
    app.get('/', (c) => c.text('ok'));

    const ctx = fakeExecutionCtx();
    await app.request('http://localhost/', {}, testEnv, ctx);

    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});
