import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from '@core/auth.service';

import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// 誤導訊息事故：跨站 cookie 沒送出去 → /api/me 401 → 前端把「讀不到」當成
// 「沒有角色」，畫面顯示「此帳號尚未被指派角色」，排查方向因此指錯地方。
describe('LoginComponent — 登入失敗訊息', () => {
  function setup(signInResult: string | null, roles: string[]) {
    const auth = {
      setRememberMe: () => undefined,
      signIn: () => Promise.resolve(signInResult),
      roles: () => roles,
      navigateToRoleShell: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });

    return { fixture: TestBed.createComponent(LoginComponent), auth };
  }

  it('讀不到帳號資料時顯示 signIn 的訊息，不是「尚未被指派角色」', async () => {
    const { fixture } = setup('登入成功，但讀不到帳號資料。請重新整理再試一次；若持續發生請聯繫管理員。', []);
    const c = fixture.componentInstance as unknown as {
      onSubmit: () => Promise<void>;
      error: () => string | null;
    };

    await c.onSubmit();

    expect(c.error()).toContain('讀不到帳號資料');
    expect(c.error()).not.toContain('尚未被指派角色');
  });

  it('帳號真的沒有角色時，才顯示「尚未被指派角色」', async () => {
    const { fixture } = setup(null, []);
    const c = fixture.componentInstance as unknown as {
      onSubmit: () => Promise<void>;
      error: () => string | null;
    };

    await c.onSubmit();

    expect(c.error()).toContain('尚未被指派角色');
  });

  it('有角色時不設錯誤，並導向對應 shell', async () => {
    const { fixture, auth } = setup(null, ['admin']);
    const c = fixture.componentInstance as unknown as {
      onSubmit: () => Promise<void>;
      error: () => string | null;
    };

    await c.onSubmit();

    expect(c.error()).toBeNull();
    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('admin');
  });
});
