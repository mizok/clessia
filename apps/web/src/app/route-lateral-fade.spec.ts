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

/** 某條 VT 規則的宣告區塊原文 */
const rule = (pseudo: string, root = ":root[data-route-dir='lateral']") => {
  const escaped = `${root}::view-transition-${pseudo}(route-content)`.replace(
    /[[\]()'.:-]/g,
    '\\$&',
  );
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};
const keyframes = (name: string) =>
  new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(css)?.[1] ?? '';

describe('同層換頁的方向（#1849，使用者 10-22）', () => {
  it('新內容從右邊 12px 淡入', () => {
    const name = /animation-name:\s*([\w-]+)/.exec(rule('new'))?.[1] ?? '';
    expect(name).not.toBe('');
    const kf = keyframes(name);
    expect(kf).toMatch(/translateX\(12px\)/);
    expect(kf).toMatch(/opacity:\s*0/);
  });

  it('舊內容原地淡出：同層不指定位移的出場動畫（沿用預設的 vt-fade-out）', () => {
    expect(rule('old')).not.toMatch(/animation-name/);
    expect(keyframes('vt-fade-out')).not.toMatch(/translate/);
  });

  it('往深一層／返回維持 24px', () => {
    expect(keyframes('vt-in-right')).toMatch(/translateX\(24px\)/);
    expect(keyframes('vt-out-left')).toMatch(/translateX\(-24px\)/);
  });
});

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
