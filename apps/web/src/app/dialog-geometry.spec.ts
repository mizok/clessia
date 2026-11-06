import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 全站彈窗幾何照 A6 `.acset`（#1776）：桌機置中、離視窗上下各 24px；手機（≤860）貼底抽屜，
 * 鍵盤升起時讓出 visual viewport 蓋掉的那一截、底部墊 safe-area。jsdom 不載全域樣式，
 * 直接讀 styles.css 原文（同 skeleton-shimmer.spec）。c6：不准 viewport 單位，用 --window-height。
 */
const css = readFileSync(join(resolve(process.cwd(), 'apps/web/src'), 'styles.css'), 'utf8');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string, from = css) =>
  new RegExp(`(?:^|\\n)\\s*${esc(sel)}\\s*\\{([^}]*)\\}`).exec(from)?.[1] ?? '';
const SHEET = '.p-dialog:not(.role-picker-dialog)';
const mobile = (() => {
  const i = css.indexOf(`${SHEET} {`);
  return i < 0 ? '' : css.slice(css.lastIndexOf('@media (max-width: 860px)', i), i + 2000);
})();

describe('全站彈窗幾何（A6 .acset，#1776）', () => {
  it('桌機：高上限＝視窗高 − 48（離底 24），不是殼層內容高', () => {
    const r = rule('.p-dialog');
    expect(r).toMatch(
      /max-height:\s*calc\(var\(--window-height[^;]*-\s*var\(--space-6\)\s*\*\s*2\)/,
    );
    expect(r).not.toContain('--shell-layout-body-height');
  });

  it('手機：貼底抽屜、寬 100%、上兩角圓、底部墊 safe-area', () => {
    const r = rule(SHEET, mobile);
    expect(r).toMatch(/width:\s*100%\s*!important/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-xl\)\s+var\(--radius-xl\)\s+0\s+0/);
    expect(r).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/);
  });

  it('手機：鍵盤升起時讓出 --keyboard-inset（遮罩底部＋高上限都扣）', () => {
    expect(rule(`.p-dialog-mask:has(> ${SHEET})`, mobile)).toMatch(
      /padding-bottom:\s*var\(--keyboard-inset/,
    );
    expect(rule(`.p-dialog-mask:has(> ${SHEET})`, mobile)).toMatch(/align-items:\s*flex-end/);
    expect(rule(SHEET, mobile)).toMatch(/max-height:[^;]*var\(--keyboard-inset/);
  });

  it('不用 viewport 單位（c6）', () => {
    expect(rule(SHEET, mobile) + rule('.p-dialog')).not.toMatch(/\d(d|s|l)?v[hw]\b/);
  });
});

/**
 * #2290 Q1（使用者 11-05）：貼底抽屜照 A6 貼底，**底部列**下內距＝--sheet-foot-gap（24，#2396）＋safe-area，
 * 鈕不貼 home indicator；沒有底部列的殼由內容區墊同一個值；抽屜本體不再墊（safe-area 只墊一次）。
 * 審核席 #2309 突變 ②：拿掉底部列的 safe-area 原本沒有任何 spec 會紅。
 */
describe('共用殼的貼底底部（#2290）', () => {
  const sheet = (() => {
    const i = css.indexOf('.dialog-frame__body {');
    const m = css.indexOf('@media (max-width: 860px)', i);
    return i < 0 || m < 0 ? '' : css.slice(m, m + 2500);
  })();
  const SAFE = /calc\(\s*var\(--sheet-foot-gap\)\s*\+\s*env\(safe-area-inset-bottom/;

  it('--sheet-foot-gap 是 24（space-6，使用者 11-06 #2396）', () => {
    expect(css).toMatch(/--sheet-foot-gap:\s*var\(--space-6\)/);
  });

  // #2396：沒走殼的 p-dialog（篩選面板）與貼底 p-drawer 也墊同一個值 —— 原本只有 12px／20px、沒有 safe-area
  it('手機：沒走殼的 p-dialog 底部列、貼底 p-drawer 內容區也是 --sheet-foot-gap＋safe-area', () => {
    expect(rule('.p-dialog:not(.role-picker-dialog) > .p-dialog-footer', css)).toMatch(SAFE);
    expect(rule('.p-drawer-bottom .p-drawer-content', css)).toMatch(SAFE);
  });

  it('手機：底部列下內距＝--sheet-foot-gap＋safe-area', () => {
    expect(rule('.form-dialog--a6 .form-dialog__footer', sheet)).toMatch(SAFE);
  });

  it('手機：沒有底部列時，殼的內容區墊同一個值', () => {
    expect(rule('.dialog-frame__body', sheet)).toMatch(SAFE);
  });

  it('手機：safe-area 只墊一次 —— 用 a6 底部列／殼的抽屜本體 padding-bottom 0', () => {
    expect(rule('.p-dialog:has(.form-dialog--a6)', sheet)).toMatch(/padding-bottom:\s*0/);
  });
});

/**
 * #2290 Q2（使用者 11-05）：減少動態時彈出物**保留淡入淡出、拿掉位移與縮放**（原本照 A6 全部關掉）。
 * 做法是在 prefers-reduced-motion 區塊把 --pop-from 設成 none（keyframes／transition 只剩 opacity）。
 * 審核席 #2309 突變 ③：拿掉這幾處 --pop-from: none 原本沒有任何 spec 會紅。
 */
describe('減少動態：彈出物只淡入淡出（#2290）', () => {
  const block = (() => {
    const i = css.indexOf(
      '@media (prefers-reduced-motion: reduce) {',
      css.indexOf('@keyframes overlay-arrive'),
    );
    if (i < 0) return '';
    let depth = 0;
    for (let j = css.indexOf('{', i); j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) return css.slice(i, j + 1);
    }
    return '';
  })();
  // 選擇器清單後面接的那一條規則
  const ruleAfter = (sel: string) =>
    new RegExp(`${esc(sel)}[^{]*\\{([^}]*)\\}`).exec(block)?.[1] ?? '';

  it('原生 popover／dialog、overlay-motion 方向、PrimeNG 對話框與浮層：--pop-from: none', () => {
    for (const sel of [
      ':where([popover], dialog)',
      '.overlay-motion--from-bottom-narrow',
      '.p-dialog-enter-active:not(.role-picker-dialog)',
      '.p-anchored-overlay-leave-active',
    ]) {
      expect(ruleAfter(sel), sel).toMatch(/--pop-from:\s*none/);
    }
  });

  it('p-drawer：換成只動透明度的 keyframes，--pop-from: none', () => {
    const enter = ruleAfter("[class*='p-drawer-enter-']");
    const leave = ruleAfter("[class*='p-drawer-leave-']");
    expect(enter).toMatch(/--pop-from:\s*none/);
    expect(enter).toMatch(/animation-name:\s*overlay-arrive/);
    expect(leave).toMatch(/--pop-from:\s*none/);
    expect(leave).toMatch(/animation-name:\s*overlay-leave/);
  });

  it('不是全部關掉：彈出物沒有 animation: none／transition: none（收合段落除外）', () => {
    const withoutDetails = block.replace(/:where\(details\)::details-content\s*\{[^}]*\}/, '');
    expect(withoutDetails).not.toMatch(/animation:\s*none/);
    expect(withoutDetails).not.toMatch(/transition:\s*none/);
  });
});
