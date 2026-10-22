import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { SkeletonComponent } from './skeleton.component';

function render(inputs: Record<string, unknown>): HTMLElement {
  const f = TestBed.createComponent(SkeletonComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

function templates(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return templates(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

describe('SkeletonComponent（#1879）', () => {
  it('列：count 列，報讀器讀到 label', () => {
    const el = render({ label: '學生載入中', count: 4 });
    expect(el.querySelectorAll('.skeleton-list__row')).toHaveLength(4);
    expect(el.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('學生載入中');
  });

  it('章節：每章一個左欄章名，列數是每章的 count', () => {
    const el = render({ label: 'x', chapter: true, chapters: 3, count: 2 });
    expect(el.querySelectorAll('.skeleton-list__head')).toHaveLength(3);
    expect(el.querySelectorAll('.skeleton-list__row')).toHaveLength(6);
  });

  it('卡片：count 格', () => {
    const el = render({ label: 'x', shape: 'cards', count: 8 });
    expect(el.querySelectorAll('.skeleton-list__cell')).toHaveLength(8);
  });

  it('沒有人再手刻舊的 skeleton-list 細條（左右縮進、三條等長的那一套）', () => {
    const app = resolve(process.cwd(), 'apps/web/src/app');
    const self = join(app, 'shared/components/skeleton/skeleton.component.html');
    const offenders = templates(app).filter(
      (p) => p !== self && /class="skeleton-list[\s"]/.test(readFileSync(p, 'utf8')),
    );
    expect(offenders).toEqual([]);
  }, 30_000); // 同步讀過整個 app 的模板：機器負載高時實測 7.4 秒，預設 5 秒會逾時假紅
});
