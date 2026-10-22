import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageOpenComponent, slideHeightOnResize } from './page-open.component';

@Component({
  imports: [PageOpenComponent],
  template: `<app-page-open [nameSize]="big()" [subLarge]="large()" [compact]="small()"
    ><ng-container openTitle>王柏翰</ng-container
    ><ng-container openSub>副行</ng-container></app-page-open
  >`,
})
class Host {
  readonly big = signal(false);
  readonly large = signal(false);
  readonly small = signal(false);
}

describe('PageOpenComponent 標題字級', () => {
  const h1 = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('h1')!;

  it('預設是一般標題 48／28（別頁不受影響）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(h1(f).classList.contains('wide:text-[48px]')).toBe(true);
    expect(h1(f).classList.contains('wide:text-[72px]')).toBe(false);
  });

  it('nameSize：人名標題桌機 72／手機 44，行高 1', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.big.set(true);
    f.detectChanges();
    expect(h1(f).classList.contains('wide:text-[72px]')).toBe(true);
    expect(h1(f).classList.contains('text-[44px]')).toBe(true);
    expect(h1(f).classList.contains('leading-none')).toBe(true);
    expect(h1(f).classList.contains('wide:text-[48px]')).toBe(false);
  });

  const sub = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('h1 + p')!;

  it('subLarge 預設關：副行一般大小；開了才放大（A6 a6.css:633）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(sub(f).classList.contains('wide:text-lg')).toBe(true);
    expect(sub(f).classList.contains('wide:text-2xl')).toBe(false);

    f.componentInstance.large.set(true);
    f.detectChanges();
    expect(sub(f).classList.contains('wide:text-2xl')).toBe(true);
    expect(sub(f).classList.contains('font-semibold')).toBe(true);
    expect(sub(f).classList.contains('wide:text-lg')).toBe(false);
  });

  // 課表（A6 schedule.css:10-11,277）：標題 40／26、桌機內距上 32／下 24；預設關，別頁不變
  describe('compact（課表色面）', () => {
    const wrap = (f: { nativeElement: HTMLElement }) =>
      f.nativeElement.querySelector('section > div.page-wrap') as HTMLElement;

    it('預設關：48／28、內距上 48／下 40；開了：40／26、上 32／下 24（手機也是）', () => {
      const f = TestBed.createComponent(Host);
      f.detectChanges();
      expect(h1(f).classList.contains('wide:text-[48px]')).toBe(true);
      expect(h1(f).classList.contains('wide:text-[40px]')).toBe(false);
      expect(wrap(f).classList.contains('wide:pt-12')).toBe(true);
      expect(wrap(f).classList.contains('wide:pb-10')).toBe(true);

      f.componentInstance.small.set(true);
      f.detectChanges();
      expect(h1(f).classList.contains('wide:text-[40px]')).toBe(true);
      expect(h1(f).classList.contains('text-[26px]')).toBe(true);
      expect(h1(f).classList.contains('wide:text-[48px]')).toBe(false);
      expect(wrap(f).classList.contains('pt-8')).toBe(true); // A6 schedule.css:10 沒有媒體查詢，手機也是 32／24
      expect(wrap(f).classList.contains('pb-6')).toBe(true);
      expect(wrap(f).classList.contains('wide:pt-12')).toBe(false);
    });

    it('人名標題（nameSize）優先：就算 compact 也是 72／44', () => {
      const f = TestBed.createComponent(Host);
      f.componentInstance.big.set(true);
      f.componentInstance.small.set(true);
      f.detectChanges();
      expect(h1(f).classList.contains('wide:text-[72px]')).toBe(true);
      expect(h1(f).classList.contains('wide:text-[40px]')).toBe(false);
    });
  });
});

describe('slideHeightOnResize（#1859：內容高度變了用滑的）', () => {
  let fire: () => void;
  let reduced = false;
  const rect = (height: number, width = 400) => ({ height, width }) as DOMRect;

  beforeEach(() => {
    reduced = false;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup(start: DOMRect) {
    let contentRect = start;
    let bandHeight = start.height;
    const running: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
    const band = {
      animate: vi.fn(() => {
        const a = { cancel: vi.fn() };
        running.push(a);
        return a;
      }),
      getAnimations: () => running,
      getBoundingClientRect: () => rect(bandHeight),
    } as unknown as HTMLElement;
    const content = { getBoundingClientRect: () => contentRect } as unknown as HTMLElement;
    slideHeightOnResize(band, content);
    return {
      band: band as unknown as { animate: ReturnType<typeof vi.fn> },
      running,
      resize: (r: DOMRect) => {
        contentRect = r;
        fire();
      },
      setBand: (h: number) => (bandHeight = h),
    };
  }

  it('標題晚到撐高：色面從舊高度滑到新高度', () => {
    const t = setup(rect(100));
    t.resize(rect(154));
    expect(t.band.animate).toHaveBeenCalledWith(
      [{ height: '100px' }, { height: '154px' }],
      expect.objectContaining({ duration: 200 }),
    );
  });

  it('寬度也變了（視窗縮放換行）不滑；高度沒變不滑', () => {
    const t = setup(rect(100));
    t.resize(rect(154, 300));
    t.resize(rect(154, 300));
    expect(t.band.animate).not.toHaveBeenCalled();
  });

  it('減少動態：不滑', () => {
    reduced = true;
    const t = setup(rect(100));
    t.resize(rect(154));
    expect(t.band.animate).not.toHaveBeenCalled();
  });

  it('連續變化：從畫面上目前的高度接著滑，並取消前一段', () => {
    const t = setup(rect(100));
    t.resize(rect(154));
    t.setBand(130); // 前一段滑到一半
    t.resize(rect(120));
    expect(t.running[0]!.cancel).toHaveBeenCalled();
    expect(t.band.animate).toHaveBeenLastCalledWith(
      [{ height: '130px' }, { height: '120px' }],
      expect.anything(),
    );
  });
});
