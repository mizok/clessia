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
    // `animation:` 簡寫也能帶入有位移的 keyframes，兩種寫法都不准（第二審核席 #1860）
    expect(rule('old')).not.toMatch(/animation(-name)?\s*:/);
    expect(keyframes('vt-fade-out')).not.toMatch(/translate/);
  });

  it('往深一層／返回維持 24px', () => {
    expect(keyframes('vt-in-right')).toMatch(/translateX\(24px\)/);
    expect(keyframes('vt-out-left')).toMatch(/translateX\(-24px\)/);
  });
});

describe('換頁時長（#1681 → #1891 放慢約 1.4 倍，使用者 10-22）', () => {
  it('同層：進 460ms、出 400ms，出場比進場短', () => {
    expect(ms('new')).toBe(460);
    expect(ms('old')).toBe(400);
    expect(ms('group')).toBe(460);
  });

  it('往深一層／返回：進 280ms、出 200ms', () => {
    for (const dir of ['forward', 'back']) {
      const root = `:root[data-route-dir='${dir}']`;
      expect(ms('new', root)).toBe(280);
      expect(ms('old', root)).toBe(200);
    }
  });

  it('預設（只剩頁內切換沿用）維持 200／140ms', () => {
    expect(ms('new', '')).toBe(200);
    expect(ms('old', '')).toBe(140);
  });
});
