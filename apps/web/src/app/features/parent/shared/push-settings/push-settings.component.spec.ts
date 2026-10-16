import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PushService, type PushState } from '@core/push.service';
import { PushSettingsComponent } from './push-settings.component';

/** 設計稿 web-push.md §4 狀態表：每一種狀態的畫面（#1663 要守住的測試） */
describe('PushSettingsComponent', () => {
  function setup(state: PushState, overrides: Partial<Record<string, unknown>> = {}) {
    const push = {
      state: signal<PushState>(state),
      refresh: vi.fn(async () => undefined),
      enable: vi.fn(async () => undefined),
      disableHere: vi.fn(async () => undefined),
      preferences: vi.fn(() =>
        of({
          role: 'parent',
          preferences: [
            { kind: 'invoice_due', enabled: true },
            { kind: 'invoice_overdue', enabled: true },
          ],
        }),
      ),
      savePreferences: vi.fn(),
      devices: vi.fn(() =>
        of({
          data: [
            {
              id: 'd1',
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1',
              createdAt: '2026-10-16T02:00:00Z',
              lastSuccessAt: null,
            },
          ],
        }),
      ),
      removeDevice: vi.fn(() => of({ success: true })),
      ...overrides,
    };
    TestBed.configureTestingModule({
      imports: [PushSettingsComponent],
      providers: [{ provide: PushService, useValue: push }],
    });
    const fixture = TestBed.createComponent(PushSettingsComponent);
    fixture.detectChanges();
    return { fixture, push, el: fixture.nativeElement as HTMLElement };
  }
  const settle = async (fixture: {
    whenStable: () => Promise<unknown>;
    detectChanges: () => void;
  }) => {
    // 類型與裝置是 refresh() 的 await 之後才載入的，多讓一輪事件迴圈
    await new Promise((done) => setTimeout(done));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';
  const buttons = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());

  it('可安裝（iOS 不是從主畫面開）：加入主畫面三步驟，沒有開啟鈕、沒有開關', async () => {
    const { fixture, el } = setup('installable');
    await settle(fixture);
    expect(el.querySelectorAll('[data-testid="ios-steps"] li').length).toBe(3);
    expect(text(el)).toContain('iOS 16.4 以上');
    expect(buttons(el)).not.toContain('開啟繳費提醒');
    expect(el.querySelector('[data-testid="push-kinds"]')).toBeNull();
  });

  it('不支援：明講收不到，請改用電話 —— 不藏起來', async () => {
    const { fixture, el } = setup('unsupported');
    await settle(fixture);
    expect(text(el)).toContain('這個瀏覽器收不到通知');
    expect(el.querySelector('[data-testid="push-kinds"]')).toBeNull();
  });

  it('部署沒開推播：說明補習班還沒開', async () => {
    const { fixture, el } = setup('not-configured');
    await settle(fixture);
    expect(text(el)).toContain('還沒有開啟手機通知');
  });

  it('尚未決定：一顆「開啟繳費提醒」，按了才要權限', async () => {
    const { fixture, el, push } = setup('default');
    await settle(fixture);
    expect(push.enable).not.toHaveBeenCalled();
    const btn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('開啟繳費提醒'),
    )!;
    btn.click();
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it('已開啟：寫明這台已開啟、可以關這台；類型開關與裝置列表', async () => {
    const { fixture, el } = setup('enabled');
    await settle(fixture);
    expect(text(el)).toContain('這台裝置已開啟通知');
    expect(buttons(el)).toContain('關閉這台裝置的通知');
    expect(text(el)).toContain('帳單即將到期');
    expect(text(el)).toContain('帳單逾期');
    expect(text(el)).toContain('iPhone · Safari');
    // #1626 Q-a：偏好只管推播，通知中心照樣有、照樣算未讀 —— 文案要講清楚
    expect(el.querySelector('[data-testid="push-kinds-note"]')!.textContent).toContain(
      '通知中心照樣會有、照樣算未讀',
    );
  });

  it('這台關掉了：開啟這台的按鈕', async () => {
    const { fixture, el } = setup('off');
    await settle(fixture);
    expect(buttons(el)).toContain('開啟這台裝置的通知');
    expect(text(el)).toContain('通知中心照樣收得到，也照樣算未讀'); // #1626 Q-a
  });

  it('被拒絕：只說明怎麼去設定打開，沒有按鈕（網頁不能再問）', async () => {
    const { fixture, el } = setup('denied');
    await settle(fixture);
    expect(el.querySelector('[data-testid="denied-how"]')?.textContent).toContain('通知');
    expect(buttons(el).filter((b) => b?.includes('開啟'))).toEqual([]);
  });

  it('類型開關存不進去：開關放回原本的樣子', async () => {
    const { fixture, push } = setup('enabled', {
      savePreferences: vi.fn(() => throwError(() => new Error('x'))),
    });
    await settle(fixture);
    const cmp = fixture.componentInstance as unknown as {
      togglePreference: (k: string, v: boolean) => void;
      preferences: () => { kind: string; enabled: boolean }[];
    };
    cmp.togglePreference('invoice_due', false);
    expect(push.savePreferences).toHaveBeenCalled();
    expect(cmp.preferences().find((p) => p.kind === 'invoice_due')?.enabled).toBe(true);
  });
});
