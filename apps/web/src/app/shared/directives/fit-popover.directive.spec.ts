import { Component, EventEmitter, forwardRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Popover } from 'primeng/popover';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FitPopoverDirective, placePopover } from './fit-popover.directive';
import { APP_DIR, appSources } from '../../../testing/source-tree';

/** #1873：篩選浮層依可用空間放。視窗 700 高，按鈕在 y=200–244；GAP 10＋MARGIN 8＝18 */
const base = { anchorTop: 200, anchorBottom: 244, viewportHeight: 700, chrome: 30 };
const BELOW = 700 - 244 - 18;

describe('placePopover（#1873）', () => {
  it('下方放得下：放下方、不翻', () => {
    const p = placePopover({ ...base, naturalHeight: 300 });
    expect(p).toEqual({ up: false, top: 244, contentMax: BELOW - 30 });
  });

  it('下方放不下、下方仍比上方大：留在下方，最大高度＝下方空間（內部捲動）', () => {
    const p = placePopover({ ...base, naturalHeight: 900 });
    expect(p.up).toBe(false);
    expect(p.contentMax).toBe(BELOW - 30);
  });

  it('按鈕在下半部、下方放不下：翻到上方，貼著按鈕往上長', () => {
    const p = placePopover({ ...base, anchorTop: 560, anchorBottom: 604, naturalHeight: 300 });
    expect(p.up).toBe(true);
    expect(p.top).toBe(560 - 300);
  });

  it('翻上去也放不下：頂到上方可用空間為止、不超出視窗頂（切掉上面的那個 bug）', () => {
    const p = placePopover({ ...base, anchorTop: 560, anchorBottom: 604, naturalHeight: 900 });
    expect(p.up).toBe(true);
    expect(p.top).toBe(560 - (560 - 18));
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.contentMax).toBe(560 - 18 - 30);
  });

  // 二讀補的邊界
  it('剛好放得下（naturalHeight＝下方空間）：不翻', () => {
    const p = placePopover({
      ...base,
      anchorTop: 560,
      anchorBottom: 604,
      naturalHeight: 700 - 604 - 18,
    });
    expect(p.up).toBe(false);
  });

  it('上下一樣大、兩邊都放不下：不翻（留在下方）', () => {
    // 上方 = 340 − 18、下方 = 700 − 360 − 18，兩邊都是 322
    const p = placePopover({ ...base, anchorTop: 340, anchorBottom: 360, naturalHeight: 900 });
    expect(p.up).toBe(false);
  });

  it('視窗矮到兩邊都不夠（可用空間為負）：top 不會跑到按鈕下面、contentMax 不為負', () => {
    const p = placePopover({
      anchorTop: 10,
      anchorBottom: 30,
      viewportHeight: 30,
      naturalHeight: 200,
      chrome: 30,
    });
    expect(p.up).toBe(true);
    expect(p.top).toBe(10);
    expect(p.contentMax).toBe(0);
  });

  it('offsetTop 下翻上去：上方空間也要扣掉 offsetTop（不然會頂到看不到的地方）', () => {
    // 看得到 300–700；按鈕 600–644。下方 = 300 + 400 − 644 − 18 = 38；上方 = 600 − 300 − 18 = 282
    const p = placePopover({
      ...base,
      viewportTop: 300,
      viewportHeight: 400,
      anchorTop: 600,
      anchorBottom: 644,
      naturalHeight: 200,
    });
    expect(p.up).toBe(true);
    expect(p.top).toBe(600 - 200);
    expect(p.contentMax).toBe(282 - 30);
  });

  it('看得到的那塊不從 0 開始（visualViewport.offsetTop，鍵盤彈出／放大）：上下空間都以它為準', () => {
    const p = placePopover({
      ...base,
      viewportTop: 300,
      anchorTop: 400,
      anchorBottom: 444,
      naturalHeight: 600,
    });
    // 下方 = 300 + 700 − 444 − 18 = 538；上方 = 400 − 300 − 18 = 82
    expect(p.up).toBe(false);
    expect(p.contentMax).toBe(538 - 30);
  });
});

/** 假的 PrimeNG Popover：只有 directive 用到的幾個成員 */
@Component({
  selector: 'p-popover',
  template: '',
  providers: [{ provide: Popover, useExisting: forwardRef(() => FakePopover) }],
})
class FakePopover {
  readonly onShow = new EventEmitter<null>();
  readonly onHide = new EventEmitter<null>();
  container: HTMLElement | null = null;
  target: HTMLElement | null = null;
}

@Component({
  imports: [FakePopover, FitPopoverDirective],
  template: `<p-popover appFitPopover />`,
})
class HostComponent {}

describe('FitPopoverDirective（#1873）', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup(
    anchor: { top: number; bottom: number },
    vv: { height: number; offsetTop: number } = { height: 700, offsetTop: 0 },
  ) {
    let notify: () => void = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollY', 100);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const pop = fixture.debugElement.children[0].injector.get(FakePopover);

    const box = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'p-popover-content';
    const inner = document.createElement('div');
    content.append(inner);
    box.append(content);
    let natural = 300;
    // 跟真的一樣：內容區被 maxHeight 限住時，量到的是限住的高度
    const contentH = () => {
      const max = parseFloat(content.style.maxHeight);
      return Number.isNaN(max) ? natural - 30 : Math.min(natural - 30, max);
    };
    Object.defineProperty(box, 'offsetHeight', { get: () => contentH() + 30 });
    Object.defineProperty(content, 'offsetHeight', { get: contentH });
    const target = document.createElement('button');
    let rect = anchor;
    target.getBoundingClientRect = () => ({ top: rect.top, bottom: rect.bottom }) as DOMRect;
    pop.container = box;
    pop.target = target;

    return {
      pop,
      box,
      content,
      inner,
      observe,
      disconnect,
      resize: (h: number, a?: { top: number; bottom: number }) => {
        natural = h;
        if (a) rect = a;
        notify();
      },
    };
  }

  it('打開：內容區設最大高度、top 加上捲動量、盯內容高度；放下方時沒有翻轉 class', () => {
    const { pop, box, content, inner, observe } = setup({ top: 200, bottom: 244 });
    pop.onShow.emit(null);
    expect(content.style.maxHeight).toBe(`${BELOW - 30}px`);
    expect(content.style.overflowY).toBe('auto');
    expect(box.style.top).toBe(`${244 + 100}px`);
    expect(box.classList).not.toContain('p-popover-flipped');
    expect(observe).toHaveBeenCalledWith(inner);
  });

  it('翻上去：箭頭改畫下緣（p-popover-flipped 與 data 屬性）', () => {
    const { pop, box } = setup({ top: 560, bottom: 604 });
    pop.onShow.emit(null);
    expect(box.classList).toContain('p-popover-flipped');
    expect(box.getAttribute('data-p-popover-flipped')).toBe('true');
    expect(box.style.top).toBe(`${560 - 300 + 100}px`);
  });

  it('內容變長（打開含歷史班級）：重算位置與最大高度；翻回下方時拿掉翻轉 class', () => {
    const { pop, box, content, resize } = setup({ top: 560, bottom: 604 });
    pop.onShow.emit(null);
    expect(box.classList).toContain('p-popover-flipped');
    resize(400, { top: 200, bottom: 244 });
    expect(box.style.top).toBe(`${244 + 100}px`);
    expect(content.style.maxHeight).toBe(`${BELOW - 30}px`);
    expect(box.classList).not.toContain('p-popover-flipped');
    expect(box.hasAttribute('data-p-popover-flipped')).toBe(false);
  });

  it('visualViewport.offsetTop 不是 0（鍵盤彈出）：照看得到的那塊放', () => {
    // 看得到 300–700；按鈕 600–644 → 翻上去，上方 282
    const { pop, box, content } = setup({ top: 600, bottom: 644 }, { height: 400, offsetTop: 300 });
    pop.onShow.emit(null);
    expect(box.classList).toContain('p-popover-flipped');
    expect(content.style.maxHeight).toBe(`${282 - 30}px`);
    expect(box.style.top).toBe(`${600 - 282 + 100}px`);
  });

  it('先被限住、內容再變長：重算時量的是沒限制的高度（量之前要先拿掉上次的 maxHeight）', () => {
    const { pop, box, resize } = setup({ top: 200, bottom: 244 });
    pop.onShow.emit(null); // 300 高放得下
    resize(600); // 下方只有 438 → 內容區被限在 408
    resize(900, { top: 560, bottom: 604 }); // 按鈕移到下半部：翻上去，用自然高度 900 → 頂到上方空間 542
    expect(box.classList).toContain('p-popover-flipped');
    expect(box.style.top).toBe(`${560 - 542 + 100}px`);
  });

  it('關閉：停止觀察', () => {
    const { pop, disconnect } = setup({ top: 200, bottom: 244 });
    pop.onShow.emit(null);
    pop.onHide.emit(null);
    expect(disconnect).toHaveBeenCalled();
  });
});

/** 掛載點：篩選浮層一律要掛 appFitPopover —— 第七頁忘了掛就會回到原本的 bug */
describe('filter-popover 掛載點（#1873）', () => {
  // 模組層掃一次（收集階段，不算進任何一條的 5s 逾時；不穩定測試盤點 C）
  const HTMLS = appSources((p) => p.endsWith('.html'));

  it('每個 styleClass="filter-popover" 的 <p-popover> 都帶 appFitPopover', () => {
    const tags = HTMLS.flatMap((f) =>
      [...f.text.matchAll(/<p-popover\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((t) => t.includes('styleClass="filter-popover"'))
        .map((t) => ({ f: f.path.slice(APP_DIR.length + 1), t })),
    );
    expect(tags.length).toBeGreaterThanOrEqual(6);
    expect(tags.filter(({ t }) => !/\bappFitPopover\b/.test(t)).map(({ f }) => f)).toEqual([]);
  });
});
