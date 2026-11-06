import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';

import { AuthService, type UserRole } from '@core/auth.service';
import { AuthProvidersService } from '@core/auth-providers.service';
import { AccountSettingsDialogComponent } from './account-settings-dialog.component';

/**
 * #1844（使用者 10-22 選 A）：不能自助啟用家長身份 —— 綁孩子只有行政能做，改由行政在家長頁一次設定。
 * 這裡只剩一行說明，不再有按鈕，也不再打已經移除的 `POST /api/me/activate-parent`。
 */
describe('AccountSettingsDialogComponent —— 家長身份改由行政設定（#1844）', () => {
  function setup(roles: UserRole[]) {
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            roles: signal(roles),
            refreshRoles: vi.fn(),
            profile: () => null,
            user: () => null,
            linkedProviders: vi.fn(async () => []),
          },
        },
        { provide: AuthProvidersService, useValue: { providers: signal(['line']) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me')).flush({});
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, http };
  }

  it('還沒有家長身分：只有一行「請洽補習班行政」，沒有啟用按鈕、不打任何啟用的 API', () => {
    const { el, http } = setup(['teacher']);
    expect(el.textContent).toContain('請洽補習班行政把你設為家長');
    expect(el.textContent).not.toContain('啟用家長身份');
    http.verify();
  });

  it('已經有家長身分：照稿寫「✓ 已啟用」，不寫洽行政（A6 .acset__sec，#2390）', () => {
    const { el } = setup(['teacher', 'parent']);
    const sec = el.querySelector('[data-testid="account-parent"]')!;
    expect(sec.textContent).toContain('家長身份');
    expect(sec.textContent).toContain('已啟用');
    expect(el.textContent).not.toContain('請洽補習班行政');
  });
});

/** #2390（gate 過）：儲存回饋照稿「儲存中…」＋toast；生日是原生 date，值就是 yyyy-MM-dd */
describe('AccountSettingsDialogComponent —— 儲存回饋與生日（#2390）', () => {
  function setup(me: Record<string, unknown>) {
    const add = vi.fn();
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            roles: signal(['admin']),
            refreshRoles: vi.fn(),
            profile: () => null,
            user: () => null,
            linkedProviders: vi.fn(async () => []),
          },
        },
        { provide: AuthProvidersService, useValue: { providers: signal(['line']) } },
        { provide: MessageService, useValue: { add } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me')).flush(me);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const saveButtons = () => [...el.querySelectorAll<HTMLButtonElement>('.account-settings__save')];
    return { fixture, http, el, add, saveButtons };
  }

  it('按「儲存」：送出中寫「儲存中…」，成功後 toast「已儲存顯示名稱」、鈕回到「儲存」', async () => {
    const { fixture, http, add, saveButtons } = setup({ displayName: '林主任' });
    await fixture.whenStable();
    saveButtons()[0].click();
    fixture.detectChanges();
    expect(saveButtons()[0].textContent).toContain('儲存中…');

    http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me')).flush({});
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: '已儲存顯示名稱' }));
    expect(saveButtons()[0].textContent!.trim()).toBe('儲存');
  });

  it('生日是原生 date：帶出 yyyy-MM-dd；改了送原值、清空送 null', async () => {
    const { fixture, http, el } = setup({ birthday: '1990-05-17' });
    // loadMe 是 firstValueFrom（多一個 microtask），ngModel 寫值又是非同步：等兩輪
    for (let i = 0; i < 2; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    const input = el.querySelector<HTMLInputElement>('#account-birthday')!;
    expect(input.type).toBe('date');
    expect(input.value).toBe('1990-05-17');

    const save = (value: string) => {
      (fixture.componentInstance as unknown as { birthday: string }).birthday = value;
      (fixture.componentInstance as unknown as { saveBirthday: () => void }).saveBirthday();
      const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me'));
      req.flush({});
      return req.request.body;
    };
    expect(save('2001-02-03')).toEqual({ birthday: '2001-02-03' });
    expect(save('')).toEqual({ birthday: null });
  });
});

/** #1665 Q6′：本人可以改自己的對外暱稱；暱稱存在 staff 列上，所以只對人員身分顯示 */
describe('AccountSettingsDialogComponent —— 對外暱稱（#1665）', () => {
  async function setup(roles: UserRole[], nickname: string | null) {
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            roles: signal(roles),
            refreshRoles: vi.fn(),
            profile: () => null,
            user: () => null,
            linkedProviders: vi.fn(async () => []),
          },
        },
        { provide: AuthProvidersService, useValue: { providers: signal(['line']) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me')).flush({ nickname });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = () => el.querySelector<HTMLInputElement>('#account-nickname');
    return { fixture, http, input };
  }

  it('老師：帶出現有暱稱；儲存送去頭尾空白的值，清空送 null', async () => {
    const { fixture, http, input } = await setup(['teacher'], '王老師');
    await fixture.whenStable();
    expect(input()?.value).toBe('王老師');

    const save = (value: string) => {
      (fixture.componentInstance as unknown as { nickname: string }).nickname = value;
      (fixture.componentInstance as unknown as { saveNickname: () => void }).saveNickname();
      return http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me')).request.body;
    };
    expect(save('  大文老師 ')).toEqual({ nickname: '大文老師' });
    expect(save('   ')).toEqual({ nickname: null });
  });

  it('只有家長身分：不顯示暱稱欄（沒有 staff 列可以寫）', async () => {
    const { input } = await setup(['parent'], null);
    expect(input()).toBeNull();
  });
});

/**
 * #1842 G-3（使用者 11-02）：「登入方式」列這個部署掛了的 provider；綁兩個以上才給「解除綁定」，
 * 只剩一個寫「至少要留一個登入方式」。伺服器端擋最後一個（契約 auth-google.contract.ts）。
 */
describe('AccountSettingsDialogComponent —— 登入方式（#1842 G-3）', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup(providers: ('line' | 'google')[], linked: string[] | null) {
    const auth = {
      roles: signal<UserRole[]>(['teacher']),
      refreshRoles: vi.fn(),
      profile: () => null,
      user: () => null,
      linkedProviders: vi.fn(async () => linked),
      linkProvider: vi.fn(async () => null),
      unlinkProvider: vi.fn(async () => null as string | null),
    };
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: AuthProvidersService, useValue: { providers: signal(providers) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    TestBed.inject(HttpTestingController)
      .match((r) => r.url.endsWith('/api/me'))
      .forEach((r) => r.flush({}));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () =>
      [...el.querySelectorAll('.account-settings__method')].map((li) =>
        (li.textContent ?? '').replace(/\s+/g, ''),
      );
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.account-settings__method button')].find((b) =>
        b.textContent?.includes(label),
      );
    // 確認走 ConfirmDialog（#2290）：攔 open，直接回「確認了」，並把帶進去的 data 交給測試看
    const dialogs = fixture.debugElement.injector.get(DialogService);
    const confirm = {
      accept: (check: (data: { message: string }) => void = () => undefined) =>
        vi.spyOn(dialogs, 'open').mockImplementation((_c, cfg) => {
          check(cfg.data as { message: string });
          return { onClose: of(true) } as never;
        }),
    };
    return { fixture, el, rows, button, auth, confirm };
  }

  it('只綁一個：寫已綁定、沒有解除鍵，並說至少要留一個', async () => {
    const { rows, el, button } = await setup(['line', 'google'], ['line']);
    expect(rows()).toEqual(['LINE已綁定', 'Google綁定Google']);
    expect(button('解除綁定')).toBeUndefined();
    expect(el.textContent).toContain('至少要留一個登入方式。');
  });

  it('綁兩個：每列都有解除鍵，不再寫至少留一個', async () => {
    const { rows, el, button } = await setup(['line', 'google'], ['line', 'google']);
    expect(rows()).toEqual(['LINE已綁定解除綁定', 'Google已綁定解除綁定']);
    expect(button('解除綁定')).toBeTruthy();
    expect(el.textContent).not.toContain('至少要留一個登入方式');
  });

  it('解除：先確認，確認後呼叫 unlinkProvider 並重讀已綁清單', async () => {
    const { fixture, button, auth, confirm } = await setup(['line', 'google'], ['line', 'google']);
    const spy = confirm.accept((data) => expect(data.message).toContain('之後請用 LINE 登入'));

    const googleRow = [...fixture.nativeElement.querySelectorAll('.account-settings__method')][1];
    (googleRow as HTMLElement).querySelector('button')!.click();
    await fixture.whenStable();

    expect(spy).toHaveBeenCalledOnce();
    expect(auth.unlinkProvider).toHaveBeenCalledWith('google');
    expect(auth.linkedProviders).toHaveBeenCalledTimes(2);
  });

  it('伺服器擋下最後一個：把原因顯示出來', async () => {
    const { fixture, auth, confirm, el } = await setup(['line', 'google'], ['line', 'google']);
    auth.unlinkProvider.mockResolvedValueOnce('至少要留一個登入方式');
    confirm.accept();
    (el.querySelector('.account-settings__method button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.account-settings__error')?.textContent).toContain(
      '至少要留一個登入方式',
    );
  });

  it('沒綁的按「綁定」走 linkProvider', async () => {
    const { button, auth } = await setup(['line', 'google'], ['line']);
    button('綁定 Google')!.click();
    expect(auth.linkProvider).toHaveBeenCalledWith('google');
  });

  it('只列這個部署掛了的（沒設 Google 就沒有 Google 列）', async () => {
    const { rows } = await setup(['line'], ['line']);
    expect(rows()).toEqual(['LINE已綁定']);
  });

  it('LINE 內建瀏覽器：沒綁的 Google 是提示，不給綁定鍵', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone) Safari Line/14.17.0',
    });
    const { button, el } = await setup(['line', 'google'], ['line']);
    expect(button('綁定 Google')).toBeUndefined();
    expect(el.querySelector('.account-settings__google-in-line')?.textContent).toContain(
      '請用 Safari 或 Chrome 打開',
    );
  });

  it('讀不到已綁清單：說讀不到，不給綁定／解除', async () => {
    const { el, button } = await setup(['line', 'google'], null);
    expect(el.textContent).toContain('讀不到登入方式');
    expect(button('綁定')).toBeUndefined();
  });
});
