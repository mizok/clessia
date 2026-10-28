import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

/**
 * #2063 實驗：iOS 主畫面 App 的 LINE 登入整段留在 App 裡。不讓 Better Auth 自動跳轉，
 * 拿到授權網址後加 `disable_auto_login=true`（不跳 LINE App），再由這個視窗頂層導航。
 * better-auth 的 client 是 Proxy spy 不到 —— 替身 fetch（auth-client.ts 每次呼叫才取）。
 */
describe('AuthService.signInWithLineInline（#2063 實驗）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(response: Response) {
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(AuthService);
    const navigate = vi
      .spyOn(service as unknown as { navigate: (url: string) => void }, 'navigate')
      .mockImplementation(() => undefined);
    return { service, fetchMock, navigate };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('要 Better Auth 不跳轉，拿到授權網址加 disable_auto_login=true，由這個視窗導航（原本的參數都在）', async () => {
    const { service, fetchMock, navigate } = setup(
      json({
        url: 'https://access.line.me/oauth2/v2.1/authorize?response_type=code&state=s1&client_id=c',
        redirect: false,
      }),
    );

    expect(await service.signInWithLineInline()).toBeNull();

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ provider: 'line', disableRedirect: true });
    expect(body.callbackURL).toBe(`${window.location.origin}/select-role`);
    const url = new URL(navigate.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(url.searchParams.get('disable_auto_login')).toBe('true');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('client_id')).toBe('c');
  });

  it('發起失敗（API 錯誤）：回訊息、不導航', async () => {
    const { service, navigate } = setup(json({ message: 'boom' }, 500));
    expect(await service.signInWithLineInline()).toBe('LINE 登入失敗，請稍後再試或聯繫補習班');
    expect(navigate).not.toHaveBeenCalled();
  });
});
