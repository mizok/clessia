import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { slideHeight } from './slide-height.directive';

describe('slideHeight（#1859：內容高度變了用滑的）', () => {
  let fire: () => void;
  let reduced = false;
  let observed: Element[] = [];

  beforeEach(() => {
    reduced = false;
    observed = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** 宿主：rect 由測試控制；子元素一個在文流、一個絕對定位 */
  function setup(height: number, width = 400) {
    const host = document.createElement('section');
    const flow = document.createElement('div');
    const deco = document.createElement('div');
    deco.style.position = 'absolute';
    host.append(flow, deco);
    let rect = { height, width };
    const running: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
    Object.assign(host, {
      getBoundingClientRect: () => rect as DOMRect,
      getAnimations: () => running.filter((a) => !a.cancel.mock.calls.length),
      animate: vi.fn(() => {
        const a = { cancel: vi.fn(), finished: new Promise(() => undefined) };
        running.push(a);
        return a;
      }),
    });
    slideHeight(host);
    const animate = (host as unknown as { animate: ReturnType<typeof vi.fn> }).animate;
    return {
      host,
      flow,
      deco,
      animate,
      running,
      set: (h: number, w = width) => (rect = { height: h, width: w }),
      resize: (h: number, w = width) => {
        rect = { height: h, width: w };
        fire();
      },
    };
  }

  it('只觀察文流中的子元素（絕對定位的裝飾層跟著宿主變高，觀察它會自己追自己）', () => {
    const t = setup(100);
    expect(observed).toContain(t.flow);
    expect(observed).not.toContain(t.deco);
  });

  it('內容撐高：從舊高度滑到新高度，動畫期間 overflow: clip', () => {
    const t = setup(193);
    t.resize(1587);
    expect(t.animate).toHaveBeenCalledWith(
      [{ height: '193px' }, { height: '1587px' }],
      expect.objectContaining({ duration: 200 }),
    );
    expect(t.host.style.overflow).toBe('clip');
  });

  it('佔位比實際高、往上收：一樣用滑的', () => {
    const t = setup(800);
    t.resize(300);
    expect(t.animate).toHaveBeenCalledWith(
      [{ height: '800px' }, { height: '300px' }],
      expect.anything(),
    );
  });

  it('寬度變了不滑；高度沒變不滑；減少動態不滑', () => {
    const t = setup(100);
    t.resize(150, 300);
    t.resize(150, 300);
    reduced = true;
    t.resize(200, 300);
    expect(t.animate).not.toHaveBeenCalled();
  });

  it('連續變化：從畫面上目前的高度接著滑，並取消前一段', () => {
    const t = setup(100);
    t.resize(200);
    // 前一段滑到一半時（畫面 150）內容又變成 120：取消前一段後讀到的自然高度是 120
    let reads = 0;
    Object.assign(t.host, {
      getBoundingClientRect: () => ({ height: reads++ === 0 ? 150 : 120, width: 400 }) as DOMRect,
    });
    fire();
    expect(t.running[0]!.cancel).toHaveBeenCalled();
    expect(t.animate).toHaveBeenLastCalledWith(
      [{ height: '150px' }, { height: '120px' }],
      expect.anything(),
    );
  });
});
