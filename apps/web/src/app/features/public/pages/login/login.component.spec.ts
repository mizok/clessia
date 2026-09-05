import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth.service';

import { LoginComponent } from './login.component';

function setupWithQueryParams(params: [string, string][]) {
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { signInWithLine: vi.fn(() => Promise.resolve(null)) } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: new Map(params) } },
      },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();

  return {
    c: fixture.componentInstance as unknown as {
      error: () => string | null;
      showEnrollmentLink: () => boolean;
      showRetry: () => boolean;
    },
    // **看真的 DOM**：signal 對了不代表畫面上有東西。
    // 這個測試原本只斷言 signal，結果 template 裡的 @if 區塊根本沒被加進去，
    // 那條連結從來沒有渲染過，而測試一直是綠的。
    enrollLink: () => (fixture.nativeElement as HTMLElement).querySelector('.login__enroll-link'),
    retryBtn: () => (fixture.nativeElement as HTMLElement).querySelector('.login__retry-btn'),
  };
}

function setupWithQueryError(errorCode: string) {
  return setupWithQueryParams([['error', errorCode]]);
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

// guard 判斷 /api/me 是暫時性錯誤（5xx、斷線）而非真的未登入時，帶
// ?reason=connection-error 導來這裡（見 auth.guard.ts）。這不是「登入失敗」，
// 訊息跟一般未登入不同，且要給重試按鈕 —— 這是本次事故裡「登入頁沒有任何
// 說明」最傷的部分。
describe('LoginComponent 讀網址上的連線異常標記', () => {
  it('顯示連線異常訊息，且畫面上真的出現重試按鈕', () => {
    const { c, retryBtn } = setupWithQueryParams([['reason', 'connection-error']]);

    expect(c.error()).toContain('連線異常');
    expect(c.showRetry()).toBe(true);
    expect(retryBtn()).not.toBeNull();
  });

  it('一般進站（沒有任何 query）不顯示重試按鈕', () => {
    const { c, retryBtn } = setupWithQueryParams([]);

    expect(c.showRetry()).toBe(false);
    expect(retryBtn()).toBeNull();
  });
});
