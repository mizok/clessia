import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 表單彈窗的動作列貼底（#1772，A6 `.fdlg__foot { position: sticky; bottom: 0 }`）。
 * sticky 會扣掉捲動容器的 padding：`.p-dialog-content` 底部 16px 留著，動作列就浮在離底 16px、
 * 底下露出捲動中的內容。jsdom 不載全域樣式，所以直接讀 styles.css 原文（同 skeleton-shimmer.spec）。
 */
const css = readFileSync(join(resolve(process.cwd(), 'apps/web/src'), 'styles.css'), 'utf8');
const rule = (sel: string) =>
  new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('表單彈窗動作列貼底（#1772）', () => {
  it('動作列 sticky bottom 0', () => {
    const r = rule('.form-dialog__footer');
    expect(r).toMatch(/position:\s*sticky/);
    expect(r).toMatch(/bottom:\s*0/);
  });

  it('有動作列的彈窗，content 底部 padding 歸 0（留白交給動作列自己的 padding）', () => {
    expect(rule('.p-dialog .p-dialog-content:has(.form-dialog__footer)')).toMatch(
      /padding-bottom:\s*0/,
    );
    // A6 `.fdlg__foot { padding: 0 24px 24px }`：按鈕下留 24px
    expect(rule('.form-dialog__footer')).toMatch(/padding-bottom:\s*var\(--space-6\)/);
  });
});
