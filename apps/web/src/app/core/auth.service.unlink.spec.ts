import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

/**
 * #2540：better-auth 1.7 的 `unlink-account` 只吃本地 `account.id`（送 providerId 會 400），
 * 而且要「新鮮」session。client 是 Proxy 抓不到，所以替身 fetch（auth-client.ts 每次呼叫才取）。
 */
describe('AuthService.unlinkProvider（better-auth 1.7）', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubApi(unlink: { status: number; body: object }) {
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(String(input), init);
        const path = new URL(req.url).pathname;
        calls.push({ path, body: req.method === 'POST' ? await req.json() : undefined });
        const json = path.endsWith('/list-accounts')
          ? [
              { id: 'acc-line', providerId: 'line' },
              { id: 'acc-google', providerId: 'google' },
            ]
          : unlink.body;
        return new Response(JSON.stringify(json), {
          status: path.endsWith('/list-accounts') ? 200 : unlink.status,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    return { service: TestBed.inject(AuthService), calls };
  }

  it('用 list-accounts 查到的 account.id 解除，不送 providerId', async () => {
    const { service, calls } = stubApi({ status: 200, body: { status: true } });

    expect(await service.unlinkProvider('google')).toBeNull();
    expect(calls.find((c) => c.path.endsWith('/unlink-account'))?.body).toEqual({
      accountId: 'acc-google',
    });
  });

  it('SESSION_NOT_FRESH → 請重新登入', async () => {
    const { service } = stubApi({ status: 403, body: { code: 'SESSION_NOT_FRESH' } });

    expect(await service.unlinkProvider('google')).toBe('為了安全，請重新登入後再解除綁定');
  });

  it('最後一個登入方式 → 至少要留一個', async () => {
    const { service } = stubApi({ status: 400, body: { code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' } });

    expect(await service.unlinkProvider('line')).toBe('至少要留一個登入方式');
  });
});
