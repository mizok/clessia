import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';

import { environment } from '@env/environment';
import { AuthHandoffService } from './auth-handoff.service';

/** #2027 iOS PWA 外部登入交接：secret 只留在 PWA、不進 URL；換到就在這個視窗打開；失效就清掉 */
describe('AuthHandoffService', () => {
  const base = `${environment.apiUrl}/api/auth-handoff`;
  const KEY = 'clessia.authHandoff';
  let service: AuthHandoffService;
  let http: HttpTestingController;
  let signOut: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  let go: ReturnType<typeof vi.fn<(u: string) => void>>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthHandoffService);
    http = TestBed.inject(HttpTestingController);
    signOut = vi.fn<() => Promise<unknown>>(async () => ({}));
    (service as unknown as { signOutHere: () => Promise<unknown> }).signOutHere = signOut;
    go = vi.fn<(u: string) => void>();
    (service as unknown as { go: (u: string) => void }).go = go;
  });

  const store = (over: Record<string, unknown> = {}) =>
    localStorage.setItem(
      KEY,
      JSON.stringify({
        id: 'h1',
        secret: 's3cret',
        pairCode: '0427',
        expiresAt: Date.now() + 60_000,
        ...over,
      }),
    );

  it('start：存 id＋secret；回的 callbackURL 只帶 id，沒有 secret', async () => {
    const p = service.start();
    http
      .expectOne({ method: 'POST', url: `${base}/start` })
      .flush({ handoffId: 'h1', secret: 's3cret', pairCode: '0427', expiresInSeconds: 600 });
    const url = await p;
    expect(url).toBe(`${window.location.origin}/login/handoff?h=h1`);
    expect(url).not.toContain('s3cret');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      id: 'h1',
      secret: 's3cret',
      pairCode: '0427',
    });
    expect(service.pendingPairCode()).toBe('0427');
    // PWA 被重新載入後沿用同一個交接（不重發新碼）
    expect(service.pendingCallbackURL()).toBe(url);
  });

  it('redeem：沒有交接 → none、不打 API；過期的 → none 並清掉', async () => {
    expect(await service.redeem()).toBe('none');
    store({ expiresAt: Date.now() - 1 });
    expect(await service.redeem()).toBe('none');
    expect(localStorage.getItem(KEY)).toBeNull();
    http.expectNone(() => true);
  });

  it('redeem：202 → pending、留著；200 → 在這個視窗打開連結、清掉', async () => {
    store();
    let p = service.redeem();
    const req = http.expectOne({ method: 'POST', url: `${base}/h1/redeem` });
    expect(req.request.body).toEqual({ secret: 's3cret' });
    req.flush({ status: 'pending' }, { status: 202, statusText: 'Accepted' });
    expect(await p).toBe('pending');
    expect(localStorage.getItem(KEY)).not.toBeNull();

    p = service.redeem();
    http.expectOne(`${base}/h1/redeem`).flush({ url: 'https://app/verify?token=t' });
    expect(await p).toBe('redirected');
    expect(go).toHaveBeenCalledWith('https://app/verify?token=t');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('redeem：404 → invalid、清掉；連線錯 → pending、留著（下次回前景再試）', async () => {
    store();
    let p = service.redeem();
    http.expectOne(`${base}/h1/redeem`).flush({}, { status: 500, statusText: 'x' });
    expect(await p).toBe('pending');
    expect(localStorage.getItem(KEY)).not.toBeNull();
    p = service.redeem();
    http.expectOne(`${base}/h1/redeem`).flush({}, { status: 404, statusText: 'x' });
    expect(await p).toBe('invalid');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it('complete：帶 cookie 與配對碼；完成 → 登出 Safari', async () => {
    const p = service.complete('h1', '0427');
    const req = http.expectOne({
      method: 'POST',
      url: `${environment.apiUrl}/api/me/auth-handoff/h1/complete`,
    });
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual({ pairCode: '0427' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await p).toEqual({ kind: 'done' });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('complete：號碼不對 → mismatch＋剩幾次，**不登出**（還能再試）；失效 → failed、登出', async () => {
    let p = service.complete('h1', '9999');
    http
      .expectOne(`${environment.apiUrl}/api/me/auth-handoff/h1/complete`)
      .flush({ code: 'PAIR_CODE_MISMATCH', attemptsLeft: 3 }, { status: 400, statusText: 'x' });
    expect(await p).toEqual({ kind: 'mismatch', attemptsLeft: 3 });
    expect(signOut).not.toHaveBeenCalled();

    p = service.complete('h1', '9999');
    http
      .expectOne(`${environment.apiUrl}/api/me/auth-handoff/h1/complete`)
      .flush({}, { status: 404, statusText: 'x' });
    expect(await p).toEqual({ kind: 'failed' });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
