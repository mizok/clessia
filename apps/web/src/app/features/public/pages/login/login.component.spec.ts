import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth.service';

import { LoginComponent } from './login.component';

function setupWithQueryError(errorCode: string) {
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { signInWithLine: vi.fn(() => Promise.resolve(null)) } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: new Map([['error', errorCode]]) } },
      },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();

  return {
    c: fixture.componentInstance as unknown as {
      error: () => string | null;
      showEnrollmentLink: () => boolean;
    },
    // **看真的 DOM**：signal 對了不代表畫面上有東西。
    // 這個測試原本只斷言 signal，結果 template 裡的 @if 區塊根本沒被加進去，
    // 那條連結從來沒有渲染過，而測試一直是綠的。
    enrollLink: () => (fixture.nativeElement as HTMLElement).querySelector('.login__enroll-link'),
  };
}

interface Harness {
  signInWithLine: () => Promise<string | null>;
  submitting: () => boolean;
  error: () => string | null;
}

function setup(signInResult: string | null | Error) {
  const auth = {
    signInWithLine: vi.fn(() =>
      signInResult instanceof Error ? Promise.reject(signInResult) : Promise.resolve(signInResult),
    ),
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

  const fixture: ComponentFixture<LoginComponent> = TestBed.createComponent(LoginComponent);
  return { fixture, auth, c: fixture.componentInstance as unknown as Harness };
}

describe('LoginComponent', () => {
  it('should create', () => {
    const { fixture } = setup(null);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('按下按鈕會把使用者交給 LINE', async () => {
    const { auth, c } = setup(null);

    await c.signInWithLine();

    expect(auth.signInWithLine).toHaveBeenCalled();
  });

  // 導向 LINE 期間畫面要有回應，否則使用者會連按好幾次
  it('進行中會鎖住按鈕', async () => {
    const { c } = setup(null);
    const pending = c.signInWithLine();

    expect(c.submitting()).toBe(true);
    await pending;
  });

  it('失敗時顯示訊息並解鎖', async () => {
    const { c } = setup('LINE 登入失敗');

    await c.signInWithLine();

    expect(c.error()).toBe('LINE 登入失敗');
    expect(c.submitting()).toBe(false);
  });

  // 例外沒被接住的話按鈕會永遠卡在「登入中」
  it('丟例外時也要解鎖，不能卡在登入中', async () => {
    const { c } = setup(new Error('network down'));

    await c.signInWithLine();

    expect(c.submitting()).toBe(false);
    expect(c.error()).toBeTruthy();
  });
});

// OAuth 失敗是被導回來時寫在網址上的。純函式對了不代表接上了 ——
// #19 的 CORS 事故就是「函式寫對但沒接上」。
describe('LoginComponent 讀網址上的 OAuth 錯誤', () => {
  it('未登記的帳號會顯示訊息，且畫面上真的出現報名連結', () => {
    const { c, enrollLink } = setupWithQueryError('signup_disabled');

    expect(c.error()).toContain('還沒有被登記');
    expect(enrollLink()).not.toBeNull();
    expect(enrollLink()?.getAttribute('href')).toBe('/enrollment');
  });

  it('其他錯誤時畫面上沒有報名連結', () => {
    const { c, enrollLink } = setupWithQueryError('state_mismatch');

    expect(c.error()).toBeTruthy();
    expect(enrollLink()).toBeNull();
  });
});
