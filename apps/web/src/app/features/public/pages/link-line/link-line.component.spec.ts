import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth.service';
import { AuthProvidersService } from '@core/auth-providers.service';

import { LinkLineComponent } from './link-line.component';

interface Harness {
  link: (provider: 'line' | 'google') => Promise<void>;
  skip: () => void;
  submitting: () => string | null;
  error: () => string | null;
}

function setup(
  linkResult: string | null | Error,
  roles: string[] = ['parent'],
  providers: ('line' | 'google')[] = ['line'],
  query: [string, string][] = [],
) {
  const auth = {
    roles: () => roles,
    navigateToRoleShell: vi.fn(),
    linkProvider: vi.fn(() =>
      linkResult instanceof Error ? Promise.reject(linkResult) : Promise.resolve(linkResult),
    ),
  };

  TestBed.configureTestingModule({
    imports: [LinkLineComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
      { provide: AuthProvidersService, useValue: { providers: signal(providers) } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(query) } } },
    ],
  });

  const fixture: ComponentFixture<LinkLineComponent> = TestBed.createComponent(LinkLineComponent);
  return { fixture, auth, c: fixture.componentInstance as unknown as Harness };
}

describe('LinkLineComponent', () => {
  // #1127：機台是平板不是人，沒有 LINE 可綁 —— 一次性連結兌換完直接進打卡頁
  it('純掃碼機台帳號：不問綁 LINE，直接進打卡頁', () => {
    const { auth } = setup(null, ['kiosk']);
    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('kiosk');
  });

  it('一般帳號照舊停在綁定頁', () => {
    const { auth } = setup(null, ['parent']);
    expect(auth.navigateToRoleShell).not.toHaveBeenCalled();
  });

  it('按下綁定會把使用者交給 LINE', async () => {
    const { auth, c } = setup(null);

    await c.link('line');

    expect(auth.linkProvider).toHaveBeenCalledWith('line');
  });

  it('失敗時顯示訊息並解鎖', async () => {
    const { c } = setup('綁定失敗');

    await c.link('line');

    expect(c.error()).toBe('綁定失敗');
    expect(c.submitting()).toBeNull();
  });

  it('丟例外時也要解鎖', async () => {
    const { c } = setup(new Error('offline'));

    await c.link('line');

    expect(c.submitting()).toBeNull();
    expect(c.error()).toBeTruthy();
  });

  // 破窗進來的人（供應商幫客戶處理問題）不會想把自己的 LINE 綁上客戶的帳號
  it('「稍後再說」直接進系統，不強迫綁定', () => {
    const { fixture, c } = setup(null);
    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();

    c.skip();

    expect(spy).toHaveBeenCalledWith(['/select-role']);
  });
});

/** #1842：依部署掛了哪些畫「綁定 ○○」；路由維持 /link-line（舊連結不能落空） */
describe('LinkLineComponent × 登入方式清單', () => {
  afterEach(() => vi.unstubAllGlobals());

  const view = (fixture: ComponentFixture<LinkLineComponent>) => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      el,
      title: el.querySelector('h1')?.textContent?.trim(),
      buttons: [...el.querySelectorAll('button')].map((b) => b.textContent?.trim()),
    };
  };

  it('只有 LINE：標題與按鈕跟以前一樣', () => {
    const { title, buttons } = view(setup(null).fixture);
    expect(title).toBe('綁定 LINE');
    expect(buttons).toEqual(['綁定 LINE 帳號', '稍後再說']);
  });

  it('兩個都有：每家一顆，按 Google 綁 Google', async () => {
    const { fixture, auth } = setup(null, ['parent'], ['line', 'google']);
    const { title, buttons, el } = view(fixture);
    expect(title).toBe('綁定登入方式');
    expect(buttons).toEqual(['綁定 LINE 帳號', '綁定 Google 帳號', '稍後再說']);
    expect(el.textContent).toContain('以後用 LINE 或 Google 就能直接登入');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Google'))!.click();
    expect(auth.linkProvider).toHaveBeenCalledWith('google');
  });

  // 一次性連結已經在 LINE 裡兌換掉：提示不能叫人「打開這個連結」
  it('LINE 內建瀏覽器：Google 是提示不是按鈕，LINE 照常', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone) Safari Line/14.17.0',
    });
    const { buttons, el } = view(setup(null, ['parent'], ['line', 'google']).fixture);
    expect(buttons).toEqual(['綁定 LINE 帳號', '稍後再說']);
    expect(el.querySelector('.link-line__google-in-line')?.textContent).toContain(
      '請向補習班重新索取連結，並用 Safari 或 Chrome 打開',
    );
  });

  it('綁定失敗被導回來（?error=&provider=google）：說清楚是哪一家、為什麼', () => {
    const { c } = setup(
      null,
      ['parent'],
      ['line', 'google'],
      [
        ['error', 'account_already_linked_to_different_user'],
        ['provider', 'google'],
      ],
    );
    expect(c.error()).toContain('這個 Google 帳號已經綁定在別的帳號上了');
  });
});
