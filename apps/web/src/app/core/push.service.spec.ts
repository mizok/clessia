import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { environment } from '@env/environment';

import { PUSH_OFF_KEY, PushService } from './push.service';

const ME = `${environment.apiUrl}/api/me`;
/** 65 bytes 的公鑰（base64url）；換金鑰的情境用第二把 */
const KEY_A = 'B' + 'A'.repeat(86);
const KEY_B = 'B' + 'Q'.repeat(86);

function bytes(key: string): ArrayBuffer {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '=');
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

/** 瀏覽器這一側的替身：權限、SW 註冊、現有訂閱 */
function browser(opts: {
  permission?: NotificationPermission;
  current?: { key: string } | null;
  supported?: boolean;
  ua?: string;
  standalone?: boolean;
}) {
  const unsubscribe = vi.fn(async () => true);
  const made = (key: string) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/x',
    options: { applicationServerKey: bytes(key) },
    toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe,
  });
  let current = opts.current ? made(opts.current.key) : null;
  const subscribe = vi.fn(async () => (current = made(KEY_A)));
  const pushManager = { getSubscription: vi.fn(async () => current), subscribe };
  const registration = { pushManager };
  if (opts.supported === false) {
    vi.stubGlobal('navigator', { userAgent: opts.ua ?? 'Mozilla/5.0', maxTouchPoints: 0 });
  } else {
    vi.stubGlobal('navigator', {
      userAgent: opts.ua ?? 'Mozilla/5.0 (Linux; Android 14)',
      maxTouchPoints: 0,
      serviceWorker: {
        register: vi.fn(async () => registration),
        getRegistration: vi.fn(async () => registration),
      },
    });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', {
      permission: opts.permission ?? 'default',
      requestPermission: vi.fn(async () => 'granted'),
    });
  }
  vi.stubGlobal('matchMedia', () => ({ matches: opts.standalone ?? false }));
  return { subscribe, unsubscribe };
}

describe('PushService（#1663，設計稿 web-push.md §4 狀態表）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(PUSH_OFF_KEY);
    TestBed.inject(HttpTestingController).verify();
  });

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return { service: TestBed.inject(PushService), http: TestBed.inject(HttpTestingController) };
  }

  /** 等某支請求出現再回它（中間有 await，請求不是同步送出的） */
  async function reply(http: HttpTestingController, method: string, url: string, body: unknown) {
    // match 會把比對到的請求從佇列拿掉，所以直接在這裡取走，不再 expectOne
    let req!: TestRequest;
    await vi.waitFor(() => {
      const found = http.match((r) => r.method === method && r.url === url);
      expect(found.length).toBe(1);
      req = found[0]!;
    });
    if (body instanceof Error)
      req.flush({ code: 'PUSH_NOT_CONFIGURED' }, { status: 404, statusText: 'x' });
    else req.flush(body as object);
    return req;
  }

  it('不支援、非 iOS：unsupported', async () => {
    browser({ supported: false });
    const { service } = setup();
    await service.refresh();
    expect(service.state()).toBe('unsupported');
  });

  it('不支援、iOS 而且不是從主畫面開的：installable（先加入主畫面）', async () => {
    browser({ supported: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
    const { service } = setup();
    await service.refresh();
    expect(service.state()).toBe('installable');
  });

  it('還沒問過：default；被拒絕：denied —— 都不打 API', async () => {
    browser({ permission: 'default' });
    const { service } = setup();
    await service.refresh();
    expect(service.state()).toBe('default');
    browser({ permission: 'denied' });
    await service.refresh();
    expect(service.state()).toBe('denied');
  });

  it('部署沒開推播（push-config 404）：not-configured', async () => {
    browser({ permission: 'granted' });
    const { service, http } = setup();
    const done = service.refresh();
    await reply(http, 'GET', `${ME}/push-config`, new Error());
    await done;
    expect(service.state()).toBe('not-configured');
  });

  it('已授權、有訂閱、金鑰相同：enabled，不重送訂閱', async () => {
    const { subscribe } = browser({ permission: 'granted', current: { key: KEY_A } });
    const { service, http } = setup();
    const done = service.refresh();
    await reply(http, 'GET', `${ME}/push-config`, { publicKey: KEY_A });
    await done;
    expect(service.state()).toBe('enabled');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('已授權但訂閱不見了：自動重訂並送給伺服器', async () => {
    const { subscribe } = browser({ permission: 'granted', current: null });
    const { service, http } = setup();
    const done = service.refresh();
    await reply(http, 'GET', `${ME}/push-config`, { publicKey: KEY_A });
    const post = await reply(http, 'POST', `${ME}/push-subscriptions`, { id: 's1' });
    await done;
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(post.request.body).toMatchObject({ keys: { p256dh: 'p', auth: 'a' } });
    expect(service.state()).toBe('enabled');
  });

  it('金鑰換了：舊訂閱取消、用新金鑰重訂', async () => {
    const { subscribe, unsubscribe } = browser({ permission: 'granted', current: { key: KEY_B } });
    const { service, http } = setup();
    const done = service.refresh();
    await reply(http, 'GET', `${ME}/push-config`, { publicKey: KEY_A });
    await reply(http, 'POST', `${ME}/push-subscriptions`, { id: 's1' });
    await done;
    expect(unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('這台裝置被關掉過（本人關、或登出）：不自動重訂，顯示 off', async () => {
    localStorage.setItem(PUSH_OFF_KEY, '1');
    const { subscribe } = browser({ permission: 'granted', current: null });
    const { service, http } = setup();
    const done = service.refresh();
    await reply(http, 'GET', `${ME}/push-config`, { publicKey: KEY_A });
    await done;
    expect(service.state()).toBe('off');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('登出前：先用 endpoint 刪伺服器那筆、再取消瀏覽器訂閱，並記下「關掉了」', async () => {
    const { unsubscribe } = browser({ permission: 'granted', current: { key: KEY_A } });
    const { service, http } = setup();
    const done = service.forgetThisDevice();
    let del!: TestRequest;
    await vi.waitFor(() => {
      const found = http.match(
        (r) => r.method === 'DELETE' && r.url === `${ME}/push-subscriptions`,
      );
      expect(found.length).toBe(1);
      del = found[0]!;
    });
    // DELETE 送出、還沒回來的這一刻，瀏覽器的訂閱還在（先刪伺服器，失敗時至少不會兩邊對不上）
    expect(del.request.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' });
    expect(unsubscribe).not.toHaveBeenCalled();
    del.flush({ deleted: 1 });
    await done;
    expect(unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem(PUSH_OFF_KEY)).toBe('1');
  });

  it('按「開啟」：清掉「關掉了」的記號，問權限、訂閱', async () => {
    localStorage.setItem(PUSH_OFF_KEY, '1');
    browser({ permission: 'default', current: null });
    const { service, http } = setup();
    const done = service.enable();
    // requestPermission 回 granted 之後，替身的 permission 也要跟著變
    (globalThis as unknown as { Notification: { permission: string } }).Notification.permission =
      'granted';
    await reply(http, 'GET', `${ME}/push-config`, { publicKey: KEY_A });
    await reply(http, 'POST', `${ME}/push-subscriptions`, { id: 's1' });
    await done;
    expect(service.state()).toBe('enabled');
    expect(localStorage.getItem(PUSH_OFF_KEY)).toBeNull();
  });
});
