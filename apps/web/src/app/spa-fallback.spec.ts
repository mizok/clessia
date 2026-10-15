/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Route } from '@angular/router';

import { routes } from './app.routes';

/**
 * #1595 1b：`_redirects` 不再用萬用的 `/* /index.html 200`，改成明列 SPA 的頂層路由。
 *
 * 為什麼：萬用規則會把**不存在的雜湊檔**（`/chunk-ZZZZ.js`）也改寫成 index.html 回 200，
 * 而 `_headers` 給雜湊檔的一年 `immutable` 跟著套上去 —— 換版的傳播窗口裡，HTML 會以
 * 真的 chunk 網址被快取一年（#1599 撤回 #1596 的原因）。Pages 的 `_redirects` 不支援回 404，
 * 所以改成「只有路由才改寫」，其他路徑落到 `404.html`。
 *
 * 代價是**漏列一條頂層路由，那個網址重新整理就 404**。所以這裡拿**實際的 router config**
 * 比對 `_redirects`，兩個方向都要成立：路由表有的都要列，列了的都要在路由表裡。
 */

const PUBLIC_DIR = resolve(process.cwd(), 'apps/web/public');

/** 路由表裡每個網址的第一段（`''` 的往下展開；`**` 另外處理） */
function topSegments(list: readonly Route[]): string[] {
  return list.flatMap((route) => {
    if (route.path === '**') return [];
    if (!route.path) return topSegments(route.children ?? []);
    return [route.path.split('/')[0]];
  });
}

/** `_redirects` 裡改寫到 index.html 的規則，回傳它們的第一段 */
function rewrittenSegments(): { segments: string[]; lines: string[] } {
  const lines = readFileSync(resolve(PUBLIC_DIR, '_redirects'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const segments = lines
    .map((line) => line.split(/\s+/))
    .filter(([, to, status]) => to === '/index.html' && status === '200')
    .map(([from]) => from.replace(/^\//, '').replace(/\/\*$/, ''));
  return { segments, lines };
}

describe('SPA fallback（_redirects）對齊路由表', () => {
  const fromRoutes = [...new Set(topSegments(routes))].sort();
  const { segments, lines } = rewrittenSegments();

  it('沒有萬用的 /* 改寫（它會把不存在的雜湊檔也改寫成 HTML）', () => {
    expect(lines.some((line) => /^\/\*\s/.test(line))).toBe(false);
  });

  it('路由表的每個頂層路由都有改寫規則（含 /x 與 /x/*）', () => {
    for (const seg of fromRoutes) {
      expect(
        segments.filter((s) => s === seg),
        `/${seg}`,
      ).toHaveLength(2);
    }
  });

  it('改寫規則列的每一段都真的在路由表裡', () => {
    expect([...new Set(segments)].sort()).toEqual(fromRoutes);
  });

  // 路由表的 `**`（打錯網址 → 登入頁）在伺服器端改由 404.html 承接：
  // 它不是空白頁，要給回首頁的連結
  it('有 ** 萬用路由，而 404.html 給得出回首頁的連結', () => {
    expect(routes.some((route) => route.path === '**')).toBe(true);
    const page = readFileSync(resolve(PUBLIC_DIR, '404.html'), 'utf8');
    expect(page).toMatch(/<a [^>]*href="\/"/);
  });
});
