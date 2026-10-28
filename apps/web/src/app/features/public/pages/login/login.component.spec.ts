import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth.service';
import { AuthHandoffService } from '@core/auth-handoff.service';
import { AppVersionService } from '@core/app-version.service';

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

  // #1718：失敗的是我們的 API（連線層），不是 LINE；而使用者實際上是重新整理之後就好了
  it('連不上伺服器（fetch 丟 TypeError）：叫人重新整理，不說「無法連線到 LINE」', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { c } = setup(new TypeError('Failed to fetch'));

    await c.signInWithLine();

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

    await c.signInWithLine();

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

    await c.signInWithLine();

    expect(TestBed.inject(AppVersionService).isStale()).toBe(true);
    expect(c.error()).toBeNull();
    expect(c.submitting()).toBe(false);
    vi.restoreAllMocks();
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
    const signInWithLine = vi.fn(() => Promise.resolve(null));
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { signInWithLine } },
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
    return { fixture, sheet, lineBtn, signInWithLine };
  }

  it('面板不在任何 inert 祖先底下', async () => {
    const { sheet } = await setupInsideInertMain();

    expect(sheet.closest('[inert]')).toBeNull();
  });

  it('面板裡的 LINE 鍵走同一個 signInWithLine', async () => {
    const { lineBtn, signInWithLine } = await setupInsideInertMain();

    lineBtn.click();

    expect(signInWithLine).toHaveBeenCalledOnce();
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
describe('LoginComponent × 外部登入交接', () => {
  async function render(
    results: Array<'none' | 'pending' | 'redirected' | 'invalid'>,
    standalone = false,
    link = 'x-safari-https://app/login/handoff/start?h=h1',
  ) {
    const redeem = vi.fn(async () => results.shift() ?? 'none');
    const start = vi.fn(async () => link);
    const signInWithLine = vi.fn(async () => null);
    const handoff = {
      redeem,
      start,
      isStandalonePwa: () => standalone,
      pendingPairCode: () => '0427',
      pendingStartLink: () => link,
    };
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { signInWithLine } },
        { provide: AuthHandoffService, useValue: handoff },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = () => el.textContent ?? '';
    const code = () => el.querySelector('[data-testid="handoff-code"]')?.textContent?.trim();
    const startLinks = () =>
      [...el.querySelectorAll<HTMLAnchorElement>('[data-testid="handoff-start-link"]')].map((a) =>
        a.getAttribute('href'),
      );
    const press = async () => {
      await (
        fixture.componentInstance as unknown as { signInWithLine: () => Promise<void> }
      ).signInWithLine();
      fixture.detectChanges();
    };
    return { fixture, redeem, start, signInWithLine, text, code, press, startLinks };
  }

  // #2063：PWA 自己呼叫 sign-in 的話 state cookie 寫在 PWA，LINE 授權完回到 Safari → state_mismatch。
  // 所以 PWA **永遠不呼叫 signInWithLine**，改給一條到外部瀏覽器發起頁的連結
  it('主畫面 PWA：按下只發起交接、顯示號碼，LINE 鍵換成到外部瀏覽器發起頁的連結；PWA 自己不去 LINE', async () => {
    const { fixture, start, signInWithLine, code, text, press, startLinks } = await render(
      [],
      true,
    );
    await press();
    expect(start).toHaveBeenCalledTimes(1);
    expect(signInWithLine).not.toHaveBeenCalled();
    expect(code()).toBe('0427');
    expect(text()).toContain('記下號碼，到瀏覽器用 LINE 登入');
    expect(startLinks()).toContain('x-safari-https://app/login/handoff/start?h=h1');
    // iOS <17 不認 x-safari-：附一般網址讓使用者自己貼到 Safari
    const fallback = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="handoff-fallback"]',
    );
    expect(fallback?.textContent).toContain('https://app/login/handoff/start?h=h1');
    expect(fallback?.textContent).not.toContain('x-safari');
  });

  it('非 iOS（發起連結是一般網址）：不顯示貼到 Safari 的退路', async () => {
    const { fixture, press } = await render([], true, 'https://app/login/handoff/start?h=h1');
    await press();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="handoff-fallback"]'),
    ).toBeNull();
  });

  it('不是主畫面 PWA：照舊直接去 LINE，不發起交接', async () => {
    const { start, signInWithLine, press } = await render([], false);
    await press();
    expect(start).not.toHaveBeenCalled();
    expect(signInWithLine).toHaveBeenCalledWith();
  });

  it('進頁換一次；還在等 → 顯示同一組號碼與同一條發起連結（沿用同一個交接、不重發）', async () => {
    const { redeem, start, signInWithLine, code, startLinks } = await render(['pending'], true);
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(code()).toBe('0427');
    expect(startLinks()).toContain('x-safari-https://app/login/handoff/start?h=h1');
    expect(start).not.toHaveBeenCalled();
    expect(signInWithLine).not.toHaveBeenCalled();
  });

  it('回到前景再換一次；失效 → 提示重按、號碼收掉', async () => {
    const { fixture, redeem, text, code } = await render(['pending', 'invalid']);
    document.dispatchEvent(new Event('visibilitychange'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(code()).toBeUndefined();
    expect(text()).toContain('登入逾時，請再按一次「使用 LINE 登入」');
  });
});
