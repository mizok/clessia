import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';

import { AuthService } from './auth.service';

const ME = {
  userId: 'u1',
  orgId: 'o1',
  displayName: '王主任',
  email: 'a@example.com',
  phone: null,
  birthday: null,
  roles: ['admin'],
  permissions: ['*'],
};

const ME_URL = `${environment.apiUrl}/api/me`;

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });

  const http = TestBed.inject(HttpTestingController);
  const service = TestBed.inject(AuthService);

  return { service, http };
}

/** 讓建構子的 init() 以「未登入」收尾，之後的測試才從乾淨狀態開始 */
async function setupSignedOut() {
  const { service, http } = setup();
  http.expectOne(ME_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
  await service.ready;
  return { service, http };
}

// ── 開站 ─────────────────────────────────────────────────────────────────────
// 原本是 getSession() 打一趟、再 await /api/me 打第二趟，兩趟序列都是
// Worker → 東京 Postgres 的往返，而 guard 在期間輪詢空轉 —— 已登入的人整頁白屏一兩秒。
// 現在只打 /api/me：200 就是已登入，401 就是未登入。

describe('AuthService 開站', () => {
  it('只打一趟 /api/me，不再先問 session', async () => {
    const { service, http } = setup();

    http.expectOne(ME_URL).flush(ME);
    await service.ready;

    http.verify(); // 沒有第二趟
  });

  it('200：一趟就把身分、角色、權限填齊', async () => {
    const { service, http } = setup();

    http.expectOne(ME_URL).flush(ME);
    await service.ready;

    expect(service.isAuthenticated()).toBe(true);
    expect(service.user()?.id).toBe('u1');
    expect(service.user()?.email).toBe('a@example.com');
    expect(service.profile()?.display_name).toBe('王主任');
    expect(service.roles()).toEqual(['admin']);
    expect(service.permissions()).toEqual(['*']);
    expect(service.activeRole()).toBe('admin');
    expect(service.loading()).toBe(false);

    http.verify();
  });

  it('401：當成未登入，不丟例外，loading 一樣要收掉', async () => {
    const { service, http } = setup();

    http.expectOne(ME_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(service.ready).resolves.toBeUndefined();

    expect(service.isAuthenticated()).toBe(false);
    expect(service.roles()).toEqual([]);
    expect(service.loading()).toBe(false);

    http.verify();
  });

  // 連不上跟「沒登入」在畫面上是同一件事（都得去登入頁），但不能是「整個 app 卡住」
  it('連線失敗也要讓 ready 完成 —— 不然 guard 會永遠等下去', async () => {
    const { service, http } = setup();

    http.expectOne(ME_URL).error(new ProgressEvent('network error'));
    await expect(service.ready).resolves.toBeUndefined();

    expect(service.loading()).toBe(false);
    http.verify();
  });
});

// ── refreshRoles ─────────────────────────────────────────────────────────────

describe('AuthService — 讀不到 profile vs 沒有角色', () => {
  it('讀到資料時回 true，並把角色寫進 signal', async () => {
    const { service, http } = await setupSignedOut();

    const result = service.refreshRoles();
    http.expectOne(ME_URL).flush(ME);

    expect(await result).toBe(true);
    expect(service.roles()).toEqual(['admin']);
    http.verify();
  });

  // 這是本次事故的核心：跨站 cookie 沒送出去 → /api/me 401，
  // 原本會被靜靜地當成「這個帳號沒有角色」
  it('401 時回 false —— 不能跟「沒有角色」混為一談', async () => {
    const { service, http } = await setupSignedOut();

    const result = service.refreshRoles();
    http
      .expectOne(ME_URL)
      .flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(await result).toBe(false);
    expect(service.roles()).toEqual([]);
    http.verify();
  });

  it('帳號真的沒有角色時回 true，角色是空的', async () => {
    const { service, http } = await setupSignedOut();

    const result = service.refreshRoles();
    http.expectOne(ME_URL).flush({ ...ME, roles: [], permissions: [] });

    expect(await result).toBe(true);
    expect(service.roles()).toEqual([]);
    http.verify();
  });
});
