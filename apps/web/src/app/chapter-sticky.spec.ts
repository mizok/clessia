import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('家長帳單：稿不是 .chap，是 .sec 標題列 —— 不用 chapter-head、也不黏（反向，#1924）', () => {
    const src = read('features/parent/pages/payments/payments.page.html');
    expect(src).not.toContain('<app-chapter-head');
    expect(src).not.toContain('wide:sticky');
  });

  it('其他用 chapter-head 的頁都沒關掉黏住', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : n.endsWith('.html') ? [p] : [];
      });
    const off = files(APP).filter((f) =>
      tagsWith(readFileSync(f, 'utf8'), '<app-chapter-head').some((t) => t.includes('pinned')),
    );
    expect(off).toEqual([]);
  });
});
