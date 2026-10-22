import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';
import { HeightFollowDirective } from './height-follow.directive';

@Component({
  imports: [HeightFollowDirective],
  template: `<div appHeightFollow><div></div></div>`,
})
class HostComponent {}

@Component({
  imports: [HeightFollowDirective],
  template: `<div appHeightFollow appHeightFollowGrow><div></div></div>`,
})
class GrowHostComponent {}

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
  async function setup(reduce = false, host: typeof HostComponent = HostComponent) {
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
    const fixture = TestBed.createComponent(host);
    const el = fixture.nativeElement.querySelector('[appHeightFollow]') as HTMLElement;
    let hostHeight = 0;
    Object.defineProperty(el, 'offsetHeight', { get: () => hostHeight });
    const animate = vi.fn(() => ({
      finished: Promise.resolve(),
      cancel: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
    }));
    el.animate = animate as unknown as HTMLElement['animate'];
    fixture.detectChanges();
    await fixture.whenStable();
    const resize = (content: number, hostNow: number) => {
      hostHeight = hostNow;
      notify(
        [{ borderBoxSize: [{ blockSize: content }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    };
    return { animate, resize, host: el };
  }

  it('連續變化（前一段還沒滑完）：從畫面上目前的高度接著滑，並取消前一段（第二審核席 #1864）', async () => {
    const { animate, resize, host } = await setup();
    const first = {
      finished: new Promise(() => undefined),
      cancel: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
    };
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

  it('距離長的滑久一點：500px 以內 200ms，800px 是 320ms（每 px 0.4ms），1500px 是 500ms 封頂（#1859 第 4 張：--arrive 第一幀不再跳掉 1/3）', async () => {
    const { animate, resize } = await setup();
    resize(100, 100);
    resize(300, 300);
    await Promise.resolve(); // 前一段滑完
    resize(1100, 1100); // 800px → 每 px 0.4ms
    await Promise.resolve();
    resize(2600, 2600);
    const durations = animate.mock.calls.map(
      (c) => (c as unknown as [Keyframe[], KeyframeAnimationOptions])[1].duration,
    );
    expect(durations).toEqual([200, 320, 500]);
  });

  it('appHeightFollowGrow：頁面剛畫出來那次只記下；之後從 0 長出來、收回 0 都滑', async () => {
    const { animate, resize } = await setup(false, GrowHostComponent);
    resize(0, 0); // 剛畫出來：提示還沒有
    expect(animate).not.toHaveBeenCalled();
    resize(44, 44); // 資料回來，提示出現
    await Promise.resolve(); // 第一段滑完
    resize(0, 0); // 處理完，提示消失
    const frames = animate.mock.calls.map((c) =>
      (c as unknown as [Keyframe[]])[0].map((f) => f['height']),
    );
    expect(frames).toEqual([
      ['0px', '44px'],
      ['44px', '0px'],
    ]);
  });

  it('建立的那一幀先停在舊高度，下一幀才開始滑（那一幀常常很重，直接 play 第一眼就是 1/3 的位置）', async () => {
    const { animate, resize } = await setup();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    resize(100, 100);
    resize(800, 800);
    const anim = animate.mock.results[0]!.value as { pause: Mock; play: Mock };
    expect(anim.pause).toHaveBeenCalled();
    expect(anim.play).not.toHaveBeenCalled();
    (raf.mock.calls[0]![0] as FrameRequestCallback)(0);
    expect(anim.play).toHaveBeenCalled();
  });

  it('下一幀之前又變了：被取消的那一段，下一幀不會被叫回來 play（第二審核席 #1902）', async () => {
    const { animate, resize } = await setup();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    resize(100, 100);
    resize(800, 800); // 第一段建立、停在第一格，等下一幀
    resize(300, 300); // 下一幀之前又變：第一段被取消、第二段建立
    const [first, second] = animate.mock.results.map(
      (r) => r.value as { cancel: Mock; play: Mock },
    );
    expect(first!.cancel).toHaveBeenCalled();
    (raf.mock.calls[0]![0] as FrameRequestCallback)(0);
    (raf.mock.calls[1]![0] as FrameRequestCallback)(0);
    expect(first!.play).not.toHaveBeenCalled();
    expect(second!.play).toHaveBeenCalled();
  });
});
