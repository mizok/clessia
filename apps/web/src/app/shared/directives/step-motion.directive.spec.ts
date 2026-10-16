import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepMotionDirective, stepMotion, type StepMotion } from './step-motion.directive';

@Component({
  imports: [StepMotionDirective],
  template: `<div [appStepMotion]="motion()"></div>`,
})
class HostComponent {
  readonly motion = signal<StepMotion | null>(null);
}

describe('StepMotionDirective', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup(reduce = false) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
    const fixture = TestBed.createComponent(HostComponent);
    const el = fixture.nativeElement.querySelector('div') as HTMLElement;
    const animate = vi.fn();
    el.animate = animate;
    fixture.detectChanges();
    return { fixture, animate };
  }

  it('沒有 motion（進頁、篩選重查）不動', () => {
    const { animate } = setup();
    expect(animate).not.toHaveBeenCalled();
  });

  it.each([
    ['forward', 'translateX(12px)'],
    ['back', 'translateX(-12px)'],
  ] as const)('%s：從 %s 淡入', (dir, from) => {
    const { fixture, animate } = setup();
    fixture.componentInstance.motion.set(stepMotion(dir));
    fixture.detectChanges();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0][0]).toEqual({ opacity: 0, transform: from });
  });

  it('減少動態：不動', () => {
    const { fixture, animate } = setup(true);
    fixture.componentInstance.motion.set(stepMotion('forward'));
    fixture.detectChanges();
    expect(animate).not.toHaveBeenCalled();
  });

  it('過期的 motion（元素因為重試之類的原因重建）不重播', () => {
    const { fixture, animate } = setup();
    fixture.componentInstance.motion.set({ dir: 'forward', at: performance.now() - 5000 });
    fixture.detectChanges();
    expect(animate).not.toHaveBeenCalled();
  });
});
