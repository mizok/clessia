import { vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { WindowSizeDirective } from './window-size.directive';

@Component({
  standalone: true,
  imports: [WindowSizeDirective],
  template: '<div class="app" appWindowSize></div>',
})
class HostComponent {}

/**
 * 這支 directive 的**唯一重點是變數寫在哪裡**。
 *
 * 原本寫在 host（`.app`）上，而三支底部抽屜是硬寫 `[appendTo]="'body'"` 的 ——
 * 它們掛在 `.app` 外面，繼承鏈上沒有那個變數，於是永遠吃 `.drawer-auto` 的
 * fallback `calc(var(--window-height, 667px) * 0.8)` = **533.6px，鎖死**。
 *
 * 而 fallback 剛好是 iPhone SE 的高度，**所以在那台機器上這個 bug 是隱形的** ——
 * 它只在比 667px 高的螢幕上顯形，也就是幾乎每一台現代手機。
 */
describe('WindowSizeDirective', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--window-width');
    document.documentElement.style.removeProperty('--window-height');
    document.documentElement.style.removeProperty('--keyboard-inset');
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.app') as HTMLElement;
  }

  it('變數寫在 documentElement 上，不是 host', () => {
    const host = render();

    expect(document.documentElement.style.getPropertyValue('--window-height')).toBe(
      `${window.innerHeight}px`,
    );
    expect(document.documentElement.style.getPropertyValue('--window-width')).toBe(
      `${window.innerWidth}px`,
    );
    // host 自己不設 —— 它靠繼承拿到同一個值
    expect(host.style.getPropertyValue('--window-height')).toBe('');
  });

  /**
   * **「.app 外面的元素也解得到」這件事沒有在這裡測，是刻意的。**
   *
   * jsdom 不傳播 CSS 自訂屬性 —— `getComputedStyle(el).getPropertyValue('--window-height')`
   * 對 `<html>` 以外的元素一律回空字串，也算不出帶自訂屬性的 `calc()`。在這裡寫那條
   * 斷言，測到的是 jsdom 的限制而不是這支 directive。
   *
   * 那一半用**瀏覽器 harness** 量了（同源 iframe 給真實 viewport 高度）：
   *
   * | 螢幕高 | 變數寫在 `.app`（修前） | 寫在 `documentElement`（修後） |
   * | --- | --- | --- |
   * | 900px | 533.6px（吃 fallback） | **720px** |
   * | 667px | 533.6px | 533.6px（fallback 剛好等於正確值） |
   *
   * 矮螢幕那一列正是這個 bug 隱形這麼久的原因：**fallback 就是 iPhone SE 的高度**。
   */
  it('視窗改變時跟著更新', () => {
    render();
    document.documentElement.style.setProperty('--window-height', '1px');

    window.dispatchEvent(new Event('resize'));

    expect(document.documentElement.style.getPropertyValue('--window-height')).toBe(
      `${window.innerHeight}px`,
    );
  });

  /**
   * 手機鍵盤（#1776）：版面視窗（innerHeight）不跟著鍵盤縮，visual viewport 會。
   * 底部抽屜要讓出「被鍵盤蓋住的那一截」，不然送出鈕在鍵盤底下。
   */
  it('--keyboard-inset＝版面視窗高 − visual viewport 的高與位移；沒有鍵盤是 0', () => {
    const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    render();
    const inset = () => document.documentElement.style.getPropertyValue('--keyboard-inset');
    expect(inset()).toBe('0px');

    vv.height = window.innerHeight - 300; // 鍵盤升起
    vv.dispatchEvent(new Event('resize'));
    expect(inset()).toBe('300px');

    vv.offsetTop = 40; // iOS 捲動時 visual viewport 往下移
    vv.dispatchEvent(new Event('scroll'));
    expect(inset()).toBe('260px');
  });

  // #1905：iOS 搜尋面板高度歸 0 的根源 —— 變數一旦寫成 0，用它算 max-height 的面板與對話框都塌成 0
  it('量到 0 或非有限值就不寫，保留上一個值', () => {
    render();
    const height = () => document.documentElement.style.getPropertyValue('--window-height');
    const width = () => document.documentElement.style.getPropertyValue('--window-width');
    const before = { h: height(), w: width() };
    expect(before.h).not.toBe('');

    for (const bad of [0, NaN, Infinity]) {
      const h = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(bad);
      const w = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(bad);
      window.dispatchEvent(new Event('resize'));
      expect(height()).toBe(before.h);
      expect(width()).toBe(before.w);
      h.mockRestore();
      w.mockRestore();
    }

    // 正常值照寫
    const h = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700);
    window.dispatchEvent(new Event('resize'));
    expect(height()).toBe('700px');
    h.mockRestore();
  });
});
