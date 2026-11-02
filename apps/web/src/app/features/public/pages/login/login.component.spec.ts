import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AuthService } from '@core/auth.service';
import { AuthProvidersService } from '@core/auth-providers.service';
import { AppVersionService } from '@core/app-version.service';

import { LoginComponent } from './login.component';

function setupWithQueryParams(params: [string, string][]) {
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { signInWith: vi.fn(() => Promise.resolve(null)) } },
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
      showRegisterHint: () => boolean;
      showRetry: () => boolean;
    },
    // **看真的 DOM**：signal 對了不代表畫面上有東西。
    // 這個測試原本只斷言 signal，結果 template 裡的 @if 區塊根本沒被加進去，
    // 那條連結從來沒有渲染過，而測試一直是綠的。
    enrollLink: () => (fixture.nativeElement as HTMLElement).querySelector('.login__enroll-link'),
    registerHint: () =>
      (fixture.nativeElement as HTMLElement).querySelector('.login__register-hint'),
    retryBtn: () => (fixture.nativeElement as HTMLElement).querySelector('.login__retry-btn'),
  };
}

function setupWithQueryError(errorCode: string) {
  return setupWithQueryParams([['error', errorCode]]);
}

interface Harness {
  signIn: (provider: 'line' | 'google') => Promise<string | null>;
  submitting: () => string | null;
  error: () => string | null;
}

function setup(signInResult: string | null | Error) {
  const auth = {
    signInWith: vi.fn(() =>
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

    await c.signIn('line');

    expect(auth.signInWith).toHaveBeenCalledWith('line');
  });

  // 導向 LINE 期間畫面要有回應，否則使用者會連按好幾次
  it('進行中會鎖住按鈕', async () => {
    const { c } = setup(null);
    const pending = c.signIn('line');

    expect(c.submitting()).toBe('line');
    await pending;
  });

  it('失敗時顯示訊息並解鎖', async () => {
    const { c } = setup('LINE 登入失敗');

    await c.signIn('line');

    expect(c.error()).toBe('LINE 登入失敗');
    expect(c.submitting()).toBeNull();
  });

  // #1718：失敗的是我們的 API（連線層），不是 LINE；而使用者實際上是重新整理之後就好了
  it('連不上伺服器（fetch 丟 TypeError）：叫人重新整理，不說「無法連線到 LINE」', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { c } = setup(new TypeError('Failed to fetch'));

    await c.signIn('line');

    expect(c.error()).toBe('連不上伺服器，請重新整理頁面後再試');
    expect(c.error()).not.toContain('LINE');
    expect(warn).toHaveBeenCalledWith('[line-login]', 'TypeError: Failed to fetch');
    warn.mockRestore();
  });

  // 計畫席：log 時不要把 token 或網址的 query 印出來
  it('記下原始錯誤時，網址的 query 遮掉', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { c } = setup(
      new Error('boom at https://api.x/api/auth/sign-in/social?state=abc&token=SECRET more'),
    );

    await c.signIn('line');

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('state=abc');
    expect(logged).toContain('https://api.x/api/auth/sign-in/social?…');
    warn.mockRestore();
  });

  it('舊版 chunk（將來 auth client 改 lazy 時）：亮新版提示條，不顯示業務錯誤', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { c } = setup(
      new TypeError('Failed to fetch dynamically imported module: https://x/chunk-A.js'),
    );

    await c.signIn('line');

    expect(TestBed.inject(AppVersionService).isStale()).toBe(true);
    expect(c.error()).toBeNull();
    expect(c.submitting()).toBeNull();
    vi.restoreAllMocks();
  });

  // 例外沒被接住的話按鈕會永遠卡在「登入中」
  it('丟例外時也要解鎖，不能卡在登入中', async () => {
    const { c } = setup(new Error('network down'));

    await c.signIn('line');

    expect(c.submitting()).toBeNull();
    expect(c.error()).toBeTruthy();
  });
});

// OAuth 失敗是被導回來時寫在網址上的。純函式對了不代表接上了 ——
// #19 的 CORS 事故就是「函式寫對但沒接上」。
describe('LoginComponent 讀網址上的 OAuth 錯誤', () => {
  /**
   * #694：原本這裡是一條「還沒報名？前往報名」→ `/enrollment`。
   *
   * **而 `/enrollment` 是純佔位殼**（模板 9 行、`<main>` 內零互動元素，
   * PR #692 逐頁量過）—— 被擋在門外的家長，唯一的出路是一扇畫在牆上的門。
   *
   * 使用者裁定：**連結拿掉，換成一句「請聯絡補習班登記」。**
   *
   * 這不是冗贅：既有的錯誤訊息覆蓋的是「**已經**報名」那半
   * （「如果你已經報名，請向補習班索取專屬連結」），
   * **而被拿掉的連結服務的是「還沒報名」那半** —— 新句子補的正是那一半。
   */
  it('未登記的帳號會顯示訊息，並改用「請聯絡補習班登記」而不是連到空殼頁', () => {
    const { c, enrollLink, registerHint } = setupWithQueryError('signup_disabled');

    expect(c.error()).toContain('還沒有被登記');
    // 連結必須消失 —— 它指向的那一頁什麼都做不了
    expect(enrollLink()).toBeNull();
    expect(registerHint()?.textContent).toContain('請聯絡補習班登記');
  });

  /**
   * **反向對照**：那句話是條件式的，不是每次都印。
   * 只有「這個 LINE 帳號還沒被登記」才需要它；
   * 使用者自己取消（`access_denied`）或別的失敗印出來只會是噪音。
   */
  it('其他錯誤時不出現那句話（也仍然沒有報名連結）', () => {
    const { c, enrollLink, registerHint } = setupWithQueryError('state_mismatch');

    expect(c.error()).toBeTruthy();
    expect(enrollLink()).toBeNull();
    expect(registerHint()).toBeNull();
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

/**
 * 手機底部面板的 LINE 鍵（#1639 二讀擋點）：殼在停留品牌面時把 `<main>` 設成 inert，
 * 而面板在模板裡住在 main 底下 —— 看得見、點不到。這裡模擬那個 inert 祖先。
 */
describe('LoginComponent 底部面板', () => {
  afterEach(() => document.getElementById('login-sheet')?.remove());

  async function setupInsideInertMain() {
    const signInWith = vi.fn(() => Promise.resolve(null));
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { signInWith } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    // 殼的 <main [inert]>：寫屬性不寫 .inert（jsdom 的 inert property 不會反映成屬性）
    (fixture.nativeElement as HTMLElement).setAttribute('inert', '');
    await fixture.whenStable();
    const sheet = document.getElementById('login-sheet')!;
    const lineBtn = [...sheet.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('使用 LINE 登入'),
    )!;
    return { fixture, sheet, lineBtn, signInWith };
  }

  it('面板不在任何 inert 祖先底下', async () => {
    const { sheet } = await setupInsideInertMain();

    expect(sheet.closest('[inert]')).toBeNull();
  });

  it('面板裡的 LINE 鍵走同一個 signIn', async () => {
    const { lineBtn, signInWith } = await setupInsideInertMain();

    lineBtn.click();

    expect(signInWith).toHaveBeenCalledExactlyOnceWith('line');
  });

  // #2031（使用者 10-23，a6-adoption-rules R5）：手機登入是置中彈窗，不是 A6 的底部面板
  it('面板是置中彈窗：不貼底、置中（m-auto）、四角圓、寬度用 % 不用 viewport 單位', async () => {
    await setupInsideInertMain();
    const sheet = document.getElementById('login-sheet')!;
    for (const c of [
      'bottom-0',
      'top-auto',
      'inset-x-0',
      'rounded-t-xl',
      'overlay-motion--from-bottom',
    ]) {
      expect(sheet.classList.contains(c), c).toBe(false);
    }
    for (const c of ['m-auto', 'rounded-xl', 'w-[calc(100%-32px)]', 'max-w-[400px]']) {
      expect(sheet.classList.contains(c), c).toBe(true);
    }
  });

  it('離開登入頁時面板跟著移除（它被搬出 host，Angular 不會替它收）', async () => {
    const { fixture } = await setupInsideInertMain();

    fixture.destroy();

    expect(document.getElementById('login-sheet')).toBeNull();
  });
});

/** #2027 iOS 主畫面 PWA：進頁、回前景都去換交接；還在等就提示回 Safari 完成；失效就請他重按 */
/**
 * #2063（使用者 10-28 iPhone 實測後裁定）：iOS 主畫面 App 的 LINE 登入整段留在 App 裡
 * （`signInWithLineInline`：不跳 LINE App，發起與回呼同一個視窗）。其他平台照舊。
 * 原本的號碼交接（#2027）前端整段拿掉了。
 */
describe('LoginComponent × iOS 主畫面 App', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)['standalone'];
  });

  async function pressWith(standalone: boolean, provider: 'line' | 'google' = 'line') {
    if (standalone)
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const signInWith = vi.fn(async () => null);
    const signInWithLineInline = vi.fn(async () => null);
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { signInWith, signInWithLineInline } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    await (fixture.componentInstance as unknown as { signIn: (p: string) => Promise<void> }).signIn(
      provider,
    );
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, signInWith, signInWithLineInline };
  }

  it('iOS 主畫面 App：LINE 鍵走 signInWithLineInline（留在 App 裡）', async () => {
    const { signInWith, signInWithLineInline } = await pressWith(true);
    expect(signInWithLineInline).toHaveBeenCalledTimes(1);
    expect(signInWith).not.toHaveBeenCalled();
  });

  it('其他平台（含 Android 的 PWA）：照舊 signInWith', async () => {
    const { signInWith, signInWithLineInline } = await pressWith(false);
    expect(signInWith).toHaveBeenCalledExactlyOnceWith('line');
    expect(signInWithLineInline).not.toHaveBeenCalled();
  });

  // #1842：Google 不會被 iOS 交給別的 App，一般流程就是同一個視窗；disable_auto_login 是 LINE 的參數
  it('iOS 主畫面 App 的 Google：走一般 signInWith，不走 LINE 的 inline', async () => {
    const { signInWith, signInWithLineInline } = await pressWith(true, 'google');
    expect(signInWith).toHaveBeenCalledExactlyOnceWith('google');
    expect(signInWithLineInline).not.toHaveBeenCalled();
  });

  it('沒有號碼交接、也沒有實驗入口的痕跡', async () => {
    const { el } = await pressWith(true);
    for (const id of [
      'handoff-code',
      'handoff-start-link',
      'handoff-fallback',
      'line-inline-experiment',
    ]) {
      expect(el.querySelector(`[data-testid="${id}"]`), id).toBeNull();
    }
  });
});

/** #1842：要畫哪幾顆由 /api/auth-providers 決定；這裡直接給清單 */
describe('LoginComponent × 登入方式清單', () => {
  afterEach(() => {
    document.getElementById('login-sheet')?.remove();
    vi.unstubAllGlobals();
  });

  function render(providers: ('line' | 'google')[], query: [string, string][] = []) {
    const signInWith = vi.fn(async () => null);
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { signInWith } },
        { provide: AuthProvidersService, useValue: { providers: signal(providers) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(query) } } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () =>
      [...el.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean);
    return { el, buttons, signInWith, text: () => el.textContent ?? '' };
  }

  it('只有 LINE：只有 LINE 鍵、字樣跟以前一樣', () => {
    const { buttons, text } = render(['line']);
    expect(buttons()).toEqual(['使用 LINE 登入']);
    expect(text()).toContain('用 LINE 登入，不需要記密碼。');
    expect(text()).toContain('點開後即可綁定 LINE。');
    expect(text()).not.toContain('Google');
  });

  it('兩個都有：LINE 在上、Google 在下，字樣不點名漏掉的', async () => {
    const { buttons, text, el, signInWith } = render(['line', 'google']);
    expect(buttons()).toEqual(['使用 LINE 登入', '使用 Google 帳戶登入']);
    expect(text()).toContain('用 LINE 或 Google 登入，不需要記密碼。');
    expect(text()).toContain('點開後即可綁定 LINE 或 Google。');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Google'))!.click();
    expect(signInWith).toHaveBeenCalledWith('google');
  });

  it('手機彈窗裡也是兩顆', () => {
    render(['line', 'google']);
    const sheet = document.getElementById('login-sheet')!;
    const labels = [...sheet.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('使用 Google 帳戶登入');
    expect(labels).toContain('使用 LINE 登入');
  });

  it('清單是空的：沒有登入鍵，說清楚找誰', () => {
    const { buttons, text } = render([]);
    expect(buttons().filter((b) => b?.includes('登入') && b !== '登入')).toEqual([]);
    expect(text()).toContain('這個部署還沒有設定登入方式，請聯絡系統管理員。');
  });

  // Google 一律擋 LINE 內建瀏覽器（403 disallowed_useragent）—— 使用者 11-02：不畫按鈕，改一行提示
  it('LINE 內建瀏覽器：Google 是一行提示、不是按鈕；LINE 鍵照常', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.17.0',
    });
    const { buttons, el } = render(['line', 'google']);
    expect(buttons()).toEqual(['使用 LINE 登入']);
    expect(el.querySelector('.login__google-in-line')?.textContent).toContain(
      '要用 Google 登入，請用 Safari 或 Chrome 打開這個網頁。',
    );
  });

  it('Google 失敗回來（?provider=google）：訊息寫 Google', () => {
    const { text } = render(
      ['line', 'google'],
      [
        ['error', 'signup_disabled'],
        ['provider', 'google'],
      ],
    );
    expect(text()).toContain('這個 Google 帳號還沒有被登記');
  });
});
