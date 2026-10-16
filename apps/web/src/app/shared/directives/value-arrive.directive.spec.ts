import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueArriveDirective } from './value-arrive.directive';

@Component({
  imports: [ValueArriveDirective],
  template: `<span [appValueArrive]="value()">{{ value() }}</span>`,
})
class HostComponent {
  readonly value = signal<number | null>(null);
}

describe('ValueArriveDirective', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup(initial: number | null, reduce = false) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.value.set(initial);
    const el = fixture.nativeElement.querySelector('span') as HTMLElement;
    const animate = vi.fn();
    el.animate = animate;
    fixture.detectChanges();
    const set = (v: number | null) => {
      fixture.componentInstance.value.set(v);
      fixture.detectChanges();
    };
    return { el, animate, set };
  }

  it('第一次出現不動', () => {
    const { animate } = setup(3);
    expect(animate).not.toHaveBeenCalled();
  });

  it('從「還沒有值」（載入中）變成有值不動', () => {
    const { animate, set } = setup(null);
    set(3);
    expect(animate).not.toHaveBeenCalled();
  });

  it('數字換了：從下方 4px 淡入 170ms（A6 dd__v.is-new）', () => {
    const { animate, set } = setup(3);
    set(4);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0][0]).toEqual({ opacity: 0, transform: 'translateY(4px)' });
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 170 });
  });

  it('同一個數字重新套上不動', () => {
    const { animate, set } = setup(3);
    set(3);
    expect(animate).not.toHaveBeenCalled();
  });

  it('減少動態：不動', () => {
    const { animate, set } = setup(3, true);
    set(4);
    expect(animate).not.toHaveBeenCalled();
  });

  it('host 是 inline-block —— transform 對 inline 元素無效', () => {
    const { el } = setup(3);
    expect(el.style.display).toBe('inline-block');
  });
});
