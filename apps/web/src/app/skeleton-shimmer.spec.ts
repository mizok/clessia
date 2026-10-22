import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1680：骨架全站一套掃光（使用者 10-16 裁定）。樣式在 styles.css，jsdom 不載全域樣式，
 * 所以直接讀原文守三件事：只有一條掃光規則、減少動態時不掃、沒有人再自己畫沒動畫的灰塊。
 */
const SRC = resolve(process.cwd(), 'apps/web/src');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
const SELECTOR = /\.skeleton,\s*\.p-skeleton,\s*\.skeleton-bar\s*\{([^}]*)\}/g;

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return templates(path);
    return /\.(html|component\.ts|page\.ts)$/.test(name) && !name.endsWith('.spec.ts')
      ? [path]
      : [];
  });
}

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
    const offenders = templates(join(SRC, 'app')).filter((path) => {
      const text = readFileSync(path, 'utf8');
      // 舊的橘帶佔位（bg-band-rule＋opacity-45）與 Tailwind 的 animate-pulse 都是另一套
      return /bg-band-rule[^"]*opacity-45|animate-pulse/.test(text);
    });
    expect(offenders).toEqual([]);
  }, 30_000); // 同步讀過整個 app 的模板：機器負載高時會超過預設 5 秒逾時（同 skeleton.component.spec）
});
