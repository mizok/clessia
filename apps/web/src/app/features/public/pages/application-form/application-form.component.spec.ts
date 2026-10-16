import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { SystemClockService } from '@core/system-clock.service';

import { ApplicationFormComponent } from './application-form.component';
import type { FormKind, FormValues, PublicCatalog } from './application-form.model';
import { PublicFormsService } from './public-forms.service';

/**
 * #1665 PR-4：公開試聽／報名表單（A6 `pub-trial.html`、`pub-enrollment.html`）。
 * API 換成替身；驗的是畫面上的字與送出去的內容。
 */

const CATALOG: PublicCatalog = {
  data: [
    {
      classId: 'c1',
      className: '國小數學 A 班',
      gradeLevels: ['P5'],
      courseId: 'co1',
      courseName: '國小數學',
      subject: '數學',
      campusName: '信義校',
      slots: [{ weekday: 3, startTime: '18:30', endTime: '20:00' }],
      remainingSeats: 2,
      fee: { amount: 4800, billingMode: 'monthly' },
      teacherNicknames: ['大文老師'],
    },
    {
      classId: 'c2',
      className: '國小數學 B 班',
      gradeLevels: ['P5'],
      courseId: 'co1',
      courseName: '國小數學',
      subject: '數學',
      campusName: '信義校',
      slots: [{ weekday: 6, startTime: '09:00', endTime: '11:00' }],
      remainingSeats: 0,
      fee: null,
      teacherNicknames: [],
    },
  ],
  campuses: [{ name: '信義校', phone: '02-2345-6789', address: '台北市信義區松仁路 1 號' }],
};

const FILLED: Partial<FormValues> = {
  parentName: '王小明',
  phone: '0912345678',
  relation: 'mother',
  studentName: '王柏翰',
  grade: 'P5',
  school: '興隆國小',
  consent: true,
};

function httpError(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new HttpErrorResponse({ status, error: body, headers: new HttpHeaders(headers) });
}

async function setup(
  kind: FormKind,
  overrides: Partial<Record<keyof PublicFormsService, unknown>> = {},
) {
  const api = {
    catalog: vi.fn().mockResolvedValue(CATALOG),
    captcha: vi.fn().mockResolvedValue({ provider: 'altcha', challenge: { parameters: {} } }),
    solveAltcha: vi.fn().mockResolvedValue('payload-1'),
    submit: vi.fn().mockResolvedValue({ id: 'app-1', waitlistClassIds: [] }),
    ...overrides,
  };
  const messages = { add: vi.fn() };
  TestBed.configureTestingModule({
    imports: [ApplicationFormComponent],
    providers: [
      provideRouter([]),
      { provide: PublicFormsService, useValue: api },
      { provide: MessageService, useValue: messages },
      { provide: SystemClockService, useValue: { todayTaipei: signal('2026-10-16') } },
    ],
  });
  const fixture = TestBed.createComponent(ApplicationFormComponent);
  fixture.componentRef.setInput('kind', kind);
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 0));
      fixture.detectChanges();
    }
  };
  await settle();
  const c = fixture.componentInstance as unknown as {
    values: { update(fn: (v: FormValues) => FormValues): void; (): FormValues };
    toggleTarget(id: string, checked: boolean): void;
    submit(): Promise<void>;
    again(): void;
  };
  const fill = (extra: Partial<FormValues> = {}) =>
    c.values.update((v) => ({ ...v, ...FILLED, ...extra }));
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  return { fixture, c, api, messages, fill, text, settle };
}

describe('ApplicationFormComponent', () => {
  // jsdom 沒有這兩個：捲到錯誤欄位、減少動態的判斷
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('試聽：課程依 courseId 合併成一列、依科目分組；也有「與學生的關係」（Q1）', async () => {
    const { text, fixture } = await setup('trial');

    expect(text()).toContain('試聽申請');
    expect(text()).toContain('與學生的關係');
    expect(text()).toContain('週三 18:30、週六 09:00 · 2 個班可選');
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('input[type=checkbox]').length,
    ).toBe(
      2, // 一門課＋同意
    );
  });

  it('報名：每班一列；老師暱稱有才寫；額滿寫「已額滿 · 勾選即登記候補」', async () => {
    const { text } = await setup('enrollment');

    expect(text()).toContain('週三 18:30–20:00 · 大文老師');
    expect(text()).toContain('剩 2 位');
    expect(text()).toContain('4,800 元／月');
    expect(text()).toContain('已額滿 · 勾選即登記候補');
  });

  it('選了年級，適合的課程標「適合小五」', async () => {
    const { c, settle, text } = await setup('trial');
    expect(text()).not.toContain('適合小五');
    c.values.update((v) => ({ ...v, grade: 'P5' }));
    await settle();
    expect(text()).toContain('適合小五');
  });

  it('空表單按送出：不送、按鈕旁寫「還沒填好：…」、逐欄標錯（送出鈕不停用）', async () => {
    const { c, api, settle, text, fixture } = await setup('trial');
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[type=submit]',
    )!;
    expect(button.disabled).toBe(false);

    await c.submit();
    await settle();

    expect(api.submit).not.toHaveBeenCalled();
    expect(text()).toContain('還沒填好：家長姓名、Email 或手機、與學生的關係');
    expect(text()).toContain('至少選一個想試聽的課程');
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-invalid="true"]').length,
    ).toBeGreaterThan(3);
  });

  it('填好送出：帶 ALTCHA 解答送出，換成結果畫面（摘要、電話、地址）', async () => {
    const { c, api, fill, settle, text, messages } = await setup('trial');
    fill({ preferredTimes: '週六下午' });
    c.toggleTarget('co1', true);

    await c.submit();
    await settle();

    expect(api.submit).toHaveBeenCalledWith(
      'trial',
      expect.objectContaining({
        courseIds: ['co1'],
        captchaToken: 'payload-1',
        preferredTimes: '週六下午',
      }),
    );
    expect(text()).toContain('試聽申請已送出');
    expect(text()).toContain('想試聽：國小數學');
    expect(text()).toContain('打 0912345678');
    expect(text()).toContain('信義校（台北市信義區松仁路 1 號）');
    expect(text()).toContain('02-2345-6789');
    expect(messages.add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '試聽申請已送出' }),
    );
  });

  it('429：讀 Retry-After 換成分鐘、附電話；填的資料都留著', async () => {
    const { c, fill, settle, text } = await setup('trial', {
      submit: vi
        .fn()
        .mockRejectedValue(httpError(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '3600' })),
    });
    fill();
    c.toggleTarget('co1', true);

    await c.submit();
    await settle();

    expect(text()).toContain(
      '送出太多次了，請 60 分鐘後再試，或直接打 02-2345-6789。你填的資料都還在。',
    );
    expect(c.values().parentName).toBe('王小明');
  });

  it('429 讀不到 Retry-After：不寫分鐘數，只寫「請稍後再試」', async () => {
    const { c, fill, settle, text } = await setup('trial', {
      submit: vi.fn().mockRejectedValue(httpError(429, { code: 'RATE_LIMITED' })),
    });
    fill();
    c.toggleTarget('co1', true);
    await c.submit();
    await settle();
    expect(text()).toContain('送出太多次了，請稍後再試');
  });

  it('CAPTCHA_FAILED：重新取一題、再算一次、自動重送', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(httpError(400, { code: 'CAPTCHA_FAILED' }))
      .mockResolvedValueOnce({ id: 'app-1' });
    const solveAltcha = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
    const { c, api, fill, settle, text } = await setup('trial', { submit, solveAltcha });
    fill();
    c.toggleTarget('co1', true);

    await c.submit();
    await settle();

    expect(api.captcha).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![1]).toMatchObject({ captchaToken: 'fresh' });
    expect(text()).toContain('試聽申請已送出');
  });

  it('CAPTCHA_FAILED 兩次：才顯示「驗證沒通過，請再按一次送出」', async () => {
    const { c, fill, settle, text } = await setup('trial', {
      submit: vi.fn().mockRejectedValue(httpError(400, { code: 'CAPTCHA_FAILED' })),
    });
    fill();
    c.toggleTarget('co1', true);
    await c.submit();
    await settle();
    expect(text()).toContain('驗證沒通過，請再按一次送出');
  });

  it('網路／500：「沒送出去，請再試一次」＋重試', async () => {
    const { c, fill, settle, text } = await setup('trial', {
      submit: vi.fn().mockRejectedValue(httpError(500, { code: 'SUBMIT_FAILED' })),
    });
    fill();
    c.toggleTarget('co1', true);
    await c.submit();
    await settle();
    expect(text()).toContain('沒送出去，請再試一次');
    expect(text()).toContain('重試');
  });

  it('404 PUBLIC_DISABLED（自架部署沒開公開頁，c12）：整頁換成請來電', async () => {
    const { text } = await setup('enrollment', {
      catalog: vi.fn().mockRejectedValue(httpError(404, { code: 'PUBLIC_DISABLED' })),
    });
    expect(text()).toContain('這個補習班目前沒有開放線上申請，請直接來電');
    expect(text()).not.toContain('家長資訊');
  });

  it('報名全部額滿：標題「已登記候補」', async () => {
    const { c, fill, settle, text } = await setup('enrollment', {
      submit: vi.fn().mockResolvedValue({ id: 'app-1', waitlistClassIds: ['c2'] }),
    });
    fill();
    c.toggleTarget('c2', true);
    await c.submit();
    await settle();
    expect(text()).toContain('已登記候補');
    expect(text()).toContain('國小數學 B 班 · 週六 09:00 · 已額滿 · 登記候補');
  });

  it('報名部分額滿：寫「其中 X 已額滿，已為您登記候補」', async () => {
    const { c, fill, settle, text } = await setup('enrollment', {
      submit: vi.fn().mockResolvedValue({ id: 'app-1', waitlistClassIds: ['c2'] }),
    });
    fill();
    c.toggleTarget('c1', true);
    c.toggleTarget('c2', true);
    await c.submit();
    await settle();
    expect(text()).toContain('申請已送出');
    expect(text()).toContain('其中 國小數學 B 班 已額滿，已為您登記候補');
  });

  it('「再幫另一個孩子申請」：保留家長、清掉孩子與課程', async () => {
    const { c, fill, settle } = await setup('trial');
    fill();
    c.toggleTarget('co1', true);
    await c.submit();
    await settle();

    c.again();
    await settle();

    expect(c.values()).toMatchObject({
      parentName: '王小明',
      phone: '0912345678',
      relation: 'mother',
      studentName: '',
      grade: '',
      targets: [],
      consent: false,
    });
  });
});
