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
  isRootUser: false,
};

describe('AuthService — 讀不到 profile vs 沒有角色', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    // constructor 的 init() 走的是「沒有 session」那條，不會發請求
  });

  afterEach(() => http.verify());

  it('讀到資料時回 true，並把角色寫進 signal', async () => {
    const result = service.refreshRoles();
    http.expectOne(`${environment.apiUrl}/api/me`).flush(ME);

    expect(await result).toBe(true);
    expect(service.roles()).toEqual(['admin']);
  });

  // 這是本次事故的核心：跨站 cookie 沒送出去 → /api/me 401，
  // 原本會被靜靜地當成「這個帳號沒有角色」
  it('401 時回 false —— 不能跟「沒有角色」混為一談', async () => {
    const result = service.refreshRoles();
    http
      .expectOne(`${environment.apiUrl}/api/me`)
      .flush({ error: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(await result).toBe(false);
    expect(service.roles()).toEqual([]);
  });

  it('帳號真的沒有角色時回 true，角色是空的', async () => {
    const result = service.refreshRoles();
    http.expectOne(`${environment.apiUrl}/api/me`).flush({ ...ME, roles: [], permissions: [] });

    expect(await result).toBe(true);
    expect(service.roles()).toEqual([]);
  });
});
