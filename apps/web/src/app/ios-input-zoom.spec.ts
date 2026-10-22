import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1867：iOS Safari 聚焦字級 < 16px 的輸入框會放大整頁。使用者 10-22 裁：viewport 加 `maximum-scale=1`，
 * **不加** `user-scalable=no`（iOS 10+ 忽略 scale 限制，兩指放大仍可用；加了 user-scalable=no 也不會更有效，只會更像在擋人）。
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/src/index.html'), 'utf8');
const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? '';

describe('iOS 聚焦放大（#1867）', () => {
  it('viewport 有 maximum-scale=1', () => {
    expect(viewport.split(',').map((s) => s.trim())).toContain('maximum-scale=1');
  });

  it('沒有 user-scalable=no', () => {
    expect(viewport).not.toMatch(/user-scalable/);
  });
});
