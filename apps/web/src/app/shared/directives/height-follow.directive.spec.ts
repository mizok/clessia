import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeightFollowDirective } from './height-follow.directive';

@Component({
  imports: [HeightFollowDirective],
  template: `<div appHeightFollow><div></div></div>`,
})
class HostComponent {}

describe('HeightFollowDirective', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** jsdom 沒有 ResizeObserver／WAAPI：替身接住 callback，`resize(內容高, 宿主高)` 模擬一次版面變化 */
  async function setup(reduce = false) {
    let notify: ResizeObserverCallback = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          notify = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.nativeElement.querySelector('[appHeightFollow]') as HTMLElement;
    let hostHeight = 0;
    Object.defineProperty(host, 'offsetHeight', { get: () => hostHeight });
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
    host.animate = animate as unknown as HTMLElement['animate'];
    fixture.detectChanges();
    await fixture.whenStable();
    const resize = (content: number, hostNow: number) => {
      hostHeight = hostNow;
      notify(
        [{ borderBoxSize: [{ blockSize: content }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    };
    return { animate, resize };
  }

  it('內容從 0 長出來（details 剛打開）不動；之後骨架換列表變高：從舊高度滑到新高度', async () => {
    const { animate, resize } = await setup();
    resize(120, 152);
    expect(animate).not.toHaveBeenCalled();

    resize(220, 252);
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0] as unknown as [Keyframe[]];
    expect(frames.map((f) => f['height'])).toEqual(['152px', '252px']);
  });

  it('高度沒變、或收起來變 0：不動', async () => {
    const { animate, resize } = await setup();
    resize(120, 152);
    resize(120, 152);
    resize(0, 0);
    expect(animate).not.toHaveBeenCalled();
  });

  it('減少動態：高度變了也不動', async () => {
    const { animate, resize } = await setup(true);
    resize(120, 152);
    resize(220, 252);
    expect(animate).not.toHaveBeenCalled();
  });
});
