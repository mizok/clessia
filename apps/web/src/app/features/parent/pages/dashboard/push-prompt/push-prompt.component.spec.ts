import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PushService, type PushState } from '@core/push.service';
import { PUSH_PROMPT_DISMISSED_KEY, PushPromptComponent } from './push-prompt.component';

/** 設計稿 web-push.md §4「入口」：只在尚未決定／可安裝時出現，關掉 30 天 */
describe('PushPromptComponent', () => {
  afterEach(() => localStorage.removeItem(PUSH_PROMPT_DISMISSED_KEY));

  function setup(state: PushState) {
    const push = {
      state: signal<PushState>(state),
      refresh: vi.fn(async () => undefined),
      enable: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      imports: [PushPromptComponent],
      providers: [provideRouter([]), { provide: PushService, useValue: push }],
    });
    const fixture = TestBed.createComponent(PushPromptComponent);
    fixture.detectChanges();
    const card = () =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="push-prompt"]');
    return { fixture, push, card };
  }

  it.each<PushState>(['default', 'installable'])('%s：出現', (state) => {
    expect(setup(state).card()).not.toBeNull();
  });

  it.each<PushState>(['enabled', 'denied', 'unsupported', 'not-configured', 'off', 'loading'])(
    '%s：不出現',
    (state) => {
      expect(setup(state).card()).toBeNull();
    },
  );

  it('關掉：記下時間，30 天內不再出現', () => {
    const { fixture, card } = setup('default');
    (card()!.querySelector('button[aria-label^="關閉提示"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(card()).toBeNull();
    expect(Number(localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY))).toBeGreaterThan(0);
  });

  it('31 天前關過：再出現一次', () => {
    localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, String(Date.now() - 31 * 24 * 60 * 60 * 1000));
    expect(setup('default').card()).not.toBeNull();
  });

  it('10 天前關過：不出現', () => {
    localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, String(Date.now() - 10 * 24 * 60 * 60 * 1000));
    expect(setup('default').card()).toBeNull();
  });
});
