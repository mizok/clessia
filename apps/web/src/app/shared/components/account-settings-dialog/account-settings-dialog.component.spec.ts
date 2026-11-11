import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
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
describe('AccountSettingsDialogComponent —— 編輯→一顆儲存（#2396）、生日（#2390）', () => {
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
    return { fixture, http, el, add };
  }

  const ci = (fixture: { componentInstance: unknown }) =>
    fixture.componentInstance as unknown as Record<string, string>;
  async function settle(fixture: {
    whenStable: () => Promise<unknown>;
    detectChanges: () => void;
  }) {
    // loadMe 是 firstValueFrom（多一個 microtask），ngModel 寫值又是非同步：等兩輪
    for (let i = 0; i < 2; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }
  const foot = (el: HTMLElement) =>
    [...el.querySelectorAll('.form-dialog__footer button')].map((b) => b.textContent!.trim());

  // #2396 拆單 4：原本每欄一顆「儲存」→ 唯讀檢視＋「編輯」→ 一顆儲存
  it('平常是唯讀檢視：沒有輸入框、內容區沒有任何「儲存」，底部列是 關閉＋編輯', async () => {
    const { fixture, el } = setup({ displayName: '林主任', phone: null });
    await settle(fixture);
    expect(el.querySelector('#account-name')).toBeNull();
    expect(el.querySelector('[data-testid="account-name-value"]')!.textContent!.trim()).toBe(
      '林主任',
    );
    expect(el.querySelector('[data-testid="account-phone-value"]')!.textContent!.trim()).toBe(
      '未填',
    );
    expect(el.querySelector('.dialog-frame__body')!.textContent).not.toContain('儲存');
    expect(foot(el)).toEqual(['關閉', '編輯']);
  });

  it('按「編輯」：欄位變輸入框、焦點到第一欄，底部列是 取消＋儲存（submit 指回表單）', async () => {
    const { fixture, el } = setup({ displayName: '林主任' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    expect(el.querySelector<HTMLInputElement>('#account-name')!.value).toBe('林主任');
    expect(document.activeElement?.id).toBe('account-name');
    expect(foot(el)).toEqual(['取消', '儲存']);
    const save = el.querySelector<HTMLButtonElement>('[data-testid="account-save"]')!;
    expect(save.type).toBe('submit');
    expect(save.getAttribute('form')).toBe('account-form');
  });

  it('儲存只送改過的欄位、一次 PATCH；點鈕與按 Enter 各送一次，成功 toast「已儲存」回到檢視', async () => {
    const { fixture, http, el, add } = setup({ displayName: '林主任', phone: '0911' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    ci(fixture)['phone'] = ' 0922 ';
    // jsdom 的 form 屬性鈕不會觸發 submit，直接送 submit 事件（同其他換殼對話框的 spec）
    el.querySelector('form#account-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me'));
    expect(req.request.body).toEqual({ phone: '0922' });
    req.flush({});
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: '已儲存' }));
    expect(foot(el)).toEqual(['關閉', '編輯']);
    http.verify();
  });

  it('送出中再按一次不會重送', async () => {
    const { fixture, http, el } = setup({ displayName: '林主任' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    ci(fixture)['displayName'] = '林老師';
    const form = el.querySelector('form#account-form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(http.match((r) => r.method === 'PATCH').length).toBe(1);
  });

  it('沒改任何東西按儲存：不打 API，直接回到檢視', async () => {
    const { fixture, http, el } = setup({ displayName: '林主任' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    el.querySelector('form#account-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectNone((r) => r.method === 'PATCH');
    fixture.detectChanges();
    expect(foot(el)).toEqual(['關閉', '編輯']);
  });

  it('取消：改到一半的值丟掉，回到上次存好的', async () => {
    const { fixture, el } = setup({ displayName: '林主任' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    ci(fixture)['displayName'] = '亂打的';
    [...el.querySelectorAll<HTMLButtonElement>('.form-dialog__footer button')]
      .find((b) => b.textContent!.includes('取消'))!
      .click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="account-name-value"]')!.textContent!.trim()).toBe(
      '林主任',
    );
  });

  // #2420 二讀：Email 確認是改寫過的路徑 —— 有改才確認、確認後一次送（含其他改過的欄）、取消不送
  function confirmSpy(fixture: ComponentFixture<AccountSettingsDialogComponent>, ok: boolean) {
    // 元件自己 provide DialogService（確認框疊在帳號設定上），從元件的 injector 拿那一份
    const dialog = fixture.debugElement.injector.get(DialogService);
    return vi
      .spyOn(dialog, 'open')
      .mockReturnValue({ onClose: of(ok) } as unknown as ReturnType<DialogService['open']>);
  }

  it('改了 Email：先確認；確認後送一次，Email 跟其他改過的欄位一起', async () => {
    const { fixture, http, el } = setup({ displayName: '林主任', email: 'a@x.tw', phone: '0911' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    const open = confirmSpy(fixture, true);
    ci(fixture)['email'] = 'b@x.tw';
    ci(fixture)['phone'] = '0922';
    el.querySelector('form#account-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1]).toEqual(expect.objectContaining({ header: '確認修改 Email' }));
    const reqs = http.match((r) => r.method === 'PATCH' && r.url.endsWith('/api/me'));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].request.body).toEqual({ email: 'b@x.tw', phone: '0922' });
  });

  it('改了 Email 但在確認時取消：不送任何東西，留在編輯', async () => {
    const { fixture, http, el } = setup({ displayName: '林主任', email: 'a@x.tw' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    confirmSpy(fixture, false);
    ci(fixture)['email'] = 'b@x.tw';
    el.querySelector('form#account-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectNone((r) => r.method === 'PATCH');
    fixture.detectChanges();
    expect(foot(el)).toEqual(['取消', '儲存']);
  });

  it('沒改 Email：不跳確認，直接送', async () => {
    const { fixture, http, el } = setup({ displayName: '林主任', email: 'a@x.tw', phone: '0911' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    const open = confirmSpy(fixture, true);
    ci(fixture)['phone'] = '0922';
    el.querySelector('form#account-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(open).not.toHaveBeenCalled();
    expect(
      http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me')).request.body,
    ).toEqual({ phone: '0922' });
  });

  it('生日是原生 date：帶出 yyyy-MM-dd；改了送原值、清空送 null', async () => {
    const { fixture, http, el } = setup({ birthday: '1990-05-17', displayName: '林主任' });
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="account-edit"]')!.click();
    await settle(fixture);
    const input = el.querySelector<HTMLInputElement>('#account-birthday')!;
    expect(input.type).toBe('date');
    expect(input.value).toBe('1990-05-17');

    const save = (value: string) => {
      ci(fixture)['birthday'] = value;
      (fixture.componentInstance as unknown as { save: () => void }).save();
      const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me'));
      const body = req.request.body;
      req.flush({});
      (fixture.componentInstance as unknown as { startEdit: () => void }).startEdit();
      return body;
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
    http
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me'))
      .flush({ displayName: '王大文', nickname });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = () =>
      el.querySelector('#account-nickname') ??
      el.querySelector('[data-testid="account-nickname-value"]');
    return { fixture, http, el, input };
  }

  it('老師：帶出現有暱稱；儲存送去頭尾空白的值，清空送 null', async () => {
    const { fixture, http, el } = await setup(['teacher'], '王老師');
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="account-nickname-value"]')!.textContent!.trim()).toBe(
      '王老師',
    );
    const c = fixture.componentInstance as unknown as {
      nickname: string;
      save: () => void;
      startEdit: () => void;
    };
    const save = (value: string) => {
      c.startEdit();
      c.nickname = value;
      c.save();
      const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me'));
      req.flush({});
      return req.request.body;
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
