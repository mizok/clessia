import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1681：同層換頁淡入淡出 0.3–0.35 秒（使用者 10-16 裁定）。jsdom 不載全域樣式，直接讀 styles.css 原文。
 */
const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8');
const ms = (pseudo: string, root = ":root[data-route-dir='lateral']") => {
  const escaped = `${root}::view-transition-${pseudo}(route-content)`.replace(
    /[[\]()'.:-]/g,
    '\\$&',
  );
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return Number(/(\d+)ms/.exec(body)?.[1]);
};

describe('同層換頁時長（#1681）', () => {
  it('進場、出場都在 300–350ms，出場比進場短', () => {
    const enter = ms('new');
    const leave = ms('old');
    expect(enter).toBeGreaterThanOrEqual(300);
    expect(enter).toBeLessThanOrEqual(350);
    expect(leave).toBeGreaterThanOrEqual(300);
    expect(leave).toBeLessThan(enter);
  });

  it('預設（往深一層／返回／頁內切換沿用）維持 200／140ms', () => {
    expect(ms('new', '')).toBe(200);
    expect(ms('old', '')).toBe(140);
  });
});
