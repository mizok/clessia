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
