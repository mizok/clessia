import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Tooltip } from 'primeng/tooltip';
import { vi } from 'vitest';
import { AutoOpenTooltipDirective } from './auto-open-tooltip.directive';

@Component({
  standalone: true,
  imports: [Tooltip, AutoOpenTooltipDirective],
  template: `
    <button
      type="button"
      pTooltip="你擁有多個角色，點擊即可切換"
      appAutoOpenTooltip
      [appAutoOpenTooltipLeaveDelay]="3000"
    >
      切換角色
    </button>
  `,
})
class HostComponent {}

describe('AutoOpenTooltipDirective', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  it('應於渲染後顯示 tooltip 並在 3 秒後隱藏', () => {
    vi.useFakeTimers();

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const tooltip = fixture.debugElement.query(By.directive(Tooltip)).injector.get(Tooltip);
    const showSpy = vi.spyOn(tooltip, 'show');
    const hideSpy = vi.spyOn(tooltip, 'hide');

    vi.advanceTimersByTime(0);
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(hideSpy).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(2999);
    expect(hideSpy).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    expect(hideSpy).toHaveBeenCalledTimes(0);

    const container = (tooltip as Tooltip & { container?: HTMLElement | null }).container ?? null;
    container?.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform' }));
    expect(hideSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
