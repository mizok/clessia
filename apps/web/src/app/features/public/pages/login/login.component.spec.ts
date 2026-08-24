import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth.service';

import { LoginComponent } from './login.component';

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
