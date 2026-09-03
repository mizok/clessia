import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { waitUntilFrom } from './wait-until';

describe('waitUntilFrom', () => {
  it('有 ExecutionContext 時回一個可呼叫的 waitUntil', async () => {
    const scheduled: unknown[] = [];
    const app = new Hono();
    app.get('/', (c) => {
      waitUntilFrom(c)?.(Promise.resolve('x'));
      return c.json({ ok: true });
    });

    await app.request('/', undefined, undefined, {
      waitUntil: (promise: unknown) => scheduled.push(promise),
      passThroughOnException: () => undefined,
    } as never);

    expect(scheduled).toHaveLength(1);
  });

  it('沒有 ExecutionContext 時回 undefined，不丟例外', async () => {
    const app = new Hono();
    app.get('/', (c) => c.json({ waitUntil: waitUntilFrom(c) === undefined ? 'none' : 'present' }));

    const response = await app.request('/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ waitUntil: 'none' });
  });

  it('⚠️ 可選鏈保護不了它 —— 這就是這支存在的理由', async () => {
    // `c.executionCtx` 是**會丟例外的 getter**，而可選鏈是在取到值之後才判斷 ——
    // 取值的當下就已經丟了。repo 裡幾處寫成 `?.` 的是假的安全感。
    const app = new Hono();
    app.get('/', (c) => {
      const ctx = c as unknown as { executionCtx?: { waitUntil?: unknown } };
      ctx.executionCtx?.waitUntil;
      return c.json({ ok: true });
    });

    const response = await app.request('/');

    // 500 = 它照樣丟了。如果哪天 Hono 改成回 undefined，這條會變綠，
    // 那時這支 helper 就可以簡化 —— 這個測試就是那個訊號
    expect(response.status).toBe(500);
  });
});
