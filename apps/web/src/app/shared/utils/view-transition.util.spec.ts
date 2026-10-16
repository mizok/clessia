import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IN_PAGE_VT_ATTR, injectViewTransition } from './view-transition.util';

describe('injectViewTransition', () => {
  const original = document.startViewTransition;
  afterEach(async () => {
    // 讓上一條的 VT 收尾（模組層的 running 會跨測試）
    await new Promise((r) => setTimeout(r, 0));
    document.startViewTransition = original;
    vi.unstubAllGlobals();
  });

  function setup({ supported, reduce }: { supported: boolean; reduce: boolean }) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() } as unknown as ViewTransition;
    });
    document.startViewTransition = (supported ? start : undefined) as never;
    const tick = vi.spyOn(TestBed.inject(ApplicationRef), 'tick').mockImplementation(() => {});
    const run = TestBed.runInInjectionContext(() => injectViewTransition());
    return { run, start, tick };
  }

  it('支援 VT：包在 startViewTransition 裡，更新後同步畫一次', () => {
    const { run, start, tick } = setup({ supported: true, reduce: false });
    const update = vi.fn();
    run(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('減少動態：直接更新，不起 VT', () => {
    const { run, start } = setup({ supported: true, reduce: true });
    const update = vi.fn();
    run(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('瀏覽器不支援：直接更新', () => {
    const { run, start } = setup({ supported: false, reduce: false });
    const update = vi.fn();
    run(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('{ rows: true }：data-vt 寫 rows（.vt-row 的名字只在這時生效）；預設寫 in-page', async () => {
    const { run } = setup({ supported: true, reduce: false });
    const seen: (string | null)[] = [];
    run(() => seen.push(document.documentElement.getAttribute(IN_PAGE_VT_ATTR)));
    await new Promise((r) => setTimeout(r, 0));
    run(() => seen.push(document.documentElement.getAttribute(IN_PAGE_VT_ATTR)), { rows: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['in-page', 'rows']);
  });

  it('前一個還在播：下一個等它播完才開始，不截斷它', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(TestBed.inject(ApplicationRef), 'tick').mockImplementation(() => {});
    const finishers: (() => void)[] = [];
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished: new Promise<void>((r) => finishers.push(r)) };
    });
    document.startViewTransition = start as never;
    const run = TestBed.runInInjectionContext(() => injectViewTransition());
    const second = vi.fn();
    run(() => {});
    run(second);
    expect(start).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    finishers[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(start).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    // 前一個收尾時不能拿掉後一個寫上的屬性（序號比對）
    expect(document.documentElement.getAttribute(IN_PAGE_VT_ATTR)).toBe('in-page');
    finishers[1]();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.hasAttribute(IN_PAGE_VT_ATTR)).toBe(false);
  });
});
