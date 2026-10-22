import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { appSources } from '../testing/source-tree';

/**
 * #1680：骨架全站一套掃光（使用者 10-16 裁定）。樣式在 styles.css，jsdom 不載全域樣式，
 * 所以直接讀原文守三件事：只有一條掃光規則、減少動態時不掃、沒有人再自己畫沒動畫的灰塊。
 */
const SRC = resolve(process.cwd(), 'apps/web/src');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
const SELECTOR = /\.skeleton,\s*\.p-skeleton,\s*\.skeleton-bar\s*\{([^}]*)\}/g;

// 模組層掃一次（收集階段，不算進任何一條的 5s 逾時；不穩定測試盤點 C）
const TEMPLATES = appSources(
  (p) => /\.(html|component\.ts|page\.ts)$/.test(p) && !p.endsWith('.spec.ts'),
);

describe('骨架掃光（#1680）', () => {
  it('三種骨架 class 共用同一條掃光規則', () => {
    const rules = [...css.matchAll(SELECTOR)].map((m) => m[1]!);
    const shimmer = rules.filter((body) => body.includes('animation: skeleton-shimmer'));
    expect(shimmer).toHaveLength(1);
    expect(shimmer[0]).toContain('var(--skeleton-duration)');
    expect(shimmer[0]).toContain('var(--skeleton-base)');
    expect(shimmer[0]).toContain('var(--skeleton-shine)');
  });

  it('一輪 1.2–1.6 秒（工單建議值）', () => {
    const seconds = Number(/--skeleton-duration:\s*([\d.]+)s/.exec(css)?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(1.2);
    expect(seconds).toBeLessThanOrEqual(1.6);
  });

  it('減少動態：同一組 class 不掃光、只留靜態底色', () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.skeleton,\s*\.p-skeleton,\s*\.skeleton-bar\s*\{([^}]*)\}/.exec(
        css,
      );
    expect(reduced?.[1]).toContain('animation: none');
    expect(reduced?.[1]).toContain('background-image: none');
  });

  it('沒有另一套骨架動畫，也沒有自己畫的沒動畫灰塊', () => {
    expect(css).not.toMatch(/@keyframes skeleton-wave/);
    // 舊的橘帶佔位（bg-band-rule＋opacity-45）與 Tailwind 的 animate-pulse 都是另一套
    const offenders = TEMPLATES.filter((f) =>
      /bg-band-rule[^"]*opacity-45|animate-pulse/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
