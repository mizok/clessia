import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';
import {
  ROUTE_DIR_ATTR,
  onRouteViewTransition,
  routeDirection,
  samePage,
  urlDepth,
} from './route-transition';

/** `/a/b/c` 這種路徑拆成一層一段的 snapshot 鏈（形狀照 router：根沒有段、往下 firstChild） */
function snap(...levels: string[][]): ActivatedRouteSnapshot {
  let child: ActivatedRouteSnapshot | null = null;
  for (const segs of [...levels].reverse()) {
    child = {
      url: segs.map((path) => ({ path })),
      firstChild: child,
    } as unknown as ActivatedRouteSnapshot;
  }
  return { url: [], firstChild: child } as unknown as ActivatedRouteSnapshot;
}

describe('urlDepth', () => {
  it('把每一層的段數加總（admin 殼 + students + :id）', () => {
    expect(urlDepth(snap(['admin'], ['students'], ['123']))).toBe(3);
  });
  it('同一層帶兩段也算兩段（exams/:type/:id/scores）', () => {
    expect(urlDepth(snap(['admin'], ['grades'], ['exams', 'school', 'x', 'scores']))).toBe(6);
  });
  it('沒有 snapshot（第一次導覽）算 0', () => {
    expect(urlDepth(null)).toBe(0);
  });
});

describe('routeDirection', () => {
  it.each([
    ['列表 → 詳情是往深', 2, 3, 'forward'],
    ['詳情 → 列表是返回', 3, 2, 'back'],
    ['選單之間是同層', 2, 2, 'lateral'],
  ] as const)('%s', (_label, from, to, expected) => {
    expect(routeDirection(from, to)).toBe(expected);
  });
});

describe('onRouteViewTransition', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(ROUTE_DIR_ATTR);
    vi.unstubAllGlobals();
  });

  function info(from: ActivatedRouteSnapshot, to: ActivatedRouteSnapshot) {
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const transition = { skipTransition: vi.fn(), finished } as unknown as ViewTransition;
    return { info: { transition, from, to } as ViewTransitionInfo, transition, finish };
  }

  function stubReducedMotion(reduce: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
  }

  it('往深一層：寫 forward，結束後拿掉', async () => {
    stubReducedMotion(false);
    const t = info(snap(['admin'], ['students']), snap(['admin'], ['students'], ['1']));
    onRouteViewTransition(t.info);
    expect(document.documentElement.getAttribute(ROUTE_DIR_ATTR)).toBe('forward');
    t.finish();
    await t.transition.finished;
    await Promise.resolve();
    expect(document.documentElement.hasAttribute(ROUTE_DIR_ATTR)).toBe(false);
  });

  it('快速連續換頁：前一個結束時不拿掉後一個的方向', async () => {
    stubReducedMotion(false);
    const first = info(snap(['admin'], ['students']), snap(['admin'], ['students'], ['1']));
    const second = info(snap(['admin'], ['students'], ['1']), snap(['admin'], ['students']));
    onRouteViewTransition(first.info);
    onRouteViewTransition(second.info);
    first.finish();
    await first.transition.finished;
    await Promise.resolve();
    expect(document.documentElement.getAttribute(ROUTE_DIR_ATTR)).toBe('back');
    second.finish();
    await second.transition.finished;
    await Promise.resolve();
    expect(document.documentElement.hasAttribute(ROUTE_DIR_ATTR)).toBe(false);
  });

  // #2292：開「全部異動」面板只加 #changes —— 換頁 VT 會把面板凍成快照、內容再淡進來
  it('只改 hash（路徑、query 都一樣）：跳過 transition、不寫方向', () => {
    stubReducedMotion(false);
    const from = snap(['admin'], ['sessions']);
    const to = snap(['admin'], ['sessions']);
    const t = info(from, to);
    onRouteViewTransition(t.info);
    expect(t.transition.skipTransition).toHaveBeenCalled();
    expect(document.documentElement.hasAttribute(ROUTE_DIR_ATTR)).toBe(false);
  });

  it('同路徑但 query 不同、或路徑不同：照常走換頁（只有 hash 才跳過）', () => {
    stubReducedMotion(false);
    expect(samePage(snap(['admin'], ['sessions']), snap(['admin'], ['students']))).toBe(false);
    const a = { ...snap(['admin'], ['sessions']), queryParams: { week: '1' } };
    const b = { ...snap(['admin'], ['sessions']), queryParams: { week: '2' } };
    expect(samePage(a as never, b as never)).toBe(false);
    expect(samePage(null, snap(['admin']))).toBe(false);
    const t = info(snap(['admin'], ['sessions']), snap(['admin'], ['students']));
    onRouteViewTransition(t.info);
    expect(t.transition.skipTransition).not.toHaveBeenCalled();
  });

  it('減少動態：跳過 transition、不寫方向', () => {
    stubReducedMotion(true);
    const t = info(snap(['admin'], ['students']), snap(['admin'], ['students'], ['1']));
    onRouteViewTransition(t.info);
    expect(t.transition.skipTransition).toHaveBeenCalled();
    expect(document.documentElement.hasAttribute(ROUTE_DIR_ATTR)).toBe(false);
  });
});
