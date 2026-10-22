import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { appSources } from '../testing/source-tree';

/**
 * A6 `.chap__side { position: sticky }`：章頭在桌機黏住，位置用 token `top-sticky-chapter`（#1766）。
 * chapter-head 元件自己的 spec 守元件；這支守**沒用元件、各頁自己畫的章頭**與家長帳單的反向 ——
 * 哪一處被拿掉 sticky，jsdom 裡畫面照樣對，只有這裡會紅。直接讀模板原文（同 skeleton-shimmer.spec）。
 */
const APP = resolve(process.cwd(), 'apps/web/src/app');
const read = (f: string) => readFileSync(join(APP, f), 'utf8');
/** 帶某個記號的開始標籤（可跨行）的 class 字串 */
const tagsWith = (src: string, mark: string) =>
  [...src.matchAll(/<(?:div|app-chapter-head)\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((t) => t.includes(mark));
const PINNED = ['wide:sticky', 'wide:top-sticky-chapter', 'wide:self-start'];

// 各頁自己畫的章頭都帶 data-testid="chapter-head"
const CASES: { name: string; file: string; mark: string; count: number }[] = [
  {
    name: '餐費：日章、班章',
    file: 'features/admin/pages/meals/meals.component.html',
    mark: 'data-testid="chapter-head"',
    count: 2,
  },
  {
    name: '帳單：逾期章',
    file: 'features/admin/pages/payments/payments.page.html',
    mark: 'data-testid="chapter-head"',
    count: 1,
  },
  {
    name: '成績學生檢視：年級章',
    file: 'features/admin/pages/grades/overview/student-view/student-view.component.html',
    mark: 'data-testid="chapter-head"',
    count: 1,
  },
  {
    name: '老師學生頁：班級章',
    file: 'features/teacher/pages/students/students.page.html',
    mark: 'data-testid="chapter-head"',
    count: 1,
  },
];

// 模組層掃一次（收集階段，不算進任何一條的 5s 逾時；不穩定測試盤點 C）
const TEMPLATES = appSources((p) => p.endsWith('.html'));

describe('章頭桌機黏住（A6 .chap__side，#1766）', () => {
  it.each(CASES)('$name：黏住、位置用 token', ({ file, mark, count }) => {
    const tags = tagsWith(read(file), mark);
    expect(tags).toHaveLength(count);
    for (const t of tags) for (const c of PINNED) expect(t).toContain(c);
  });

  it('change-log-list（全部異動）：寬版章頭黏住、位置用 token', () => {
    const line = /chapterHead:\s*'([^']*)'/.exec(
      read('shared/components/change-log-list/change-log-list.component.ts'),
    )?.[1];
    for (const c of PINNED) expect(line).toContain(c);
  });

  it('家長帳單：稿不是 .chap，章頭不黏（反向）', () => {
    const tags = tagsWith(
      read('features/parent/pages/payments/payments.page.html'),
      '<app-chapter-head',
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('[pinned]="false"');
  });

  it('其他用 chapter-head 的頁都沒關掉黏住', () => {
    const off = TEMPLATES.filter(
      (f) => !f.path.endsWith('parent/pages/payments/payments.page.html'),
    )
      .filter((f) => tagsWith(f.text, '<app-chapter-head').some((t) => t.includes('pinned')))
      .map((f) => f.path);
    expect(off).toEqual([]);
  });
});
