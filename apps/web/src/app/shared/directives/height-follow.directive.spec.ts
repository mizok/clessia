import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeightFollowDirective } from './height-follow.directive';

@Component({
  imports: [HeightFollowDirective],
  template: `<div appHeightFollow><div></div></div>`,
})
class HostComponent {}

@Component({
  imports: [HeightFollowDirective],
  template: `<section appHeightFollow>
    <div style="position: absolute"></div>
    <div class="content"></div>
  </section>`,
})
class DecoratedHostComponent {}

describe('HeightFollowDirective 跳過絕對定位的子元素（#1859）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('第一個子元素是鋪滿的裝飾層時，量的是第一個在文流中的子元素', async () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    const fixture = TestBed.createComponent(DecoratedHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(observed).toHaveLength(1);
    expect(observed[0]!.classList).toContain('content');
  });
});

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
    return { animate, resize, host };
  }

  it('連續變化（前一段還沒滑完）：從畫面上目前的高度接著滑，並取消前一段（第二審核席 #1864）', async () => {
    const { animate, resize, host } = await setup();
    const first = { finished: new Promise(() => undefined), cancel: vi.fn() };
    animate.mockReturnValueOnce(first as never);
    resize(100, 100); // 第一次量到，不動
    resize(200, 200); // 100 → 200，滑到一半
    host.getBoundingClientRect = () => ({ height: 150 }) as DOMRect;
    resize(120, 120); // 又變成 120
    expect(first.cancel).toHaveBeenCalled();
    const [frames] = animate.mock.calls.at(-1) as unknown as [Keyframe[]];
    expect(frames.map((f) => f['height'])).toEqual(['150px', '120px']);
  });

  it('第一段滑完之後再變一次：第二段從第一段的終點（B）滑到 C，不是從起點 A（第二審核席 #1864）', async () => {
    const { animate, resize } = await setup();
    resize(100, 100); // A：第一次量到，不動
    resize(200, 200); // A → B
    await Promise.resolve(); // 第一段的 finished 結束
    resize(260, 260); // B → C
    const frames = animate.mock.calls.map((c) =>
      (c as unknown as [Keyframe[]])[0].map((f) => f['height']),
    );
    expect(frames).toEqual([
      ['100px', '200px'],
      ['200px', '260px'],
    ]);
  });

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
