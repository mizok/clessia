import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { injectOptimisticRemove } from './optimistic-remove.util';

// jsdom 沒有 startViewTransition → helper 直接同步更新，這裡只驗資料面
describe('injectOptimisticRemove', () => {
  function setup() {
    const remove = TestBed.runInInjectionContext(() => injectOptimisticRemove());
    const list = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const req = new Subject<void>();
    const next = vi.fn();
    const error = vi.fn();
    remove(list, (x) => x.id === 'b', req, { next, error });
    return { list, req, next, error };
  }

  it('按下的那一刻就拿掉（不等回應）', () => {
    const { list, next } = setup();
    expect(list().map((x) => x.id)).toEqual(['a', 'c']);
    expect(next).not.toHaveBeenCalled();
  });

  it('成功：維持拿掉、呼叫 next', () => {
    const { list, req, next, error } = setup();
    req.next();
    req.complete();
    expect(list().map((x) => x.id)).toEqual(['a', 'c']);
    expect(next).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('失敗：放回原位（順序不變）、呼叫 error 讓使用者知道', () => {
    const { list, req, next, error } = setup();
    req.error(new Error('boom'));
    expect(list().map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
