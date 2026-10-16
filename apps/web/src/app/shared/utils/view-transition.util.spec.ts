import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectViewTransition } from './view-transition.util';

describe('injectViewTransition', () => {
  const original = document.startViewTransition;
  afterEach(() => {
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
});
