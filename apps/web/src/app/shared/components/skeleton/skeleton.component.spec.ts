import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { APP_DIR, appSources } from '../../../../testing/source-tree';
import { SkeletonComponent } from './skeleton.component';

// 模組層掃一次（收集階段，不算進任何一條的 5s 逾時；不穩定測試盤點 C）
const TEMPLATES = appSources((p) => p.endsWith('.html'));

function render(inputs: Record<string, unknown>): HTMLElement {
  const f = TestBed.createComponent(SkeletonComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
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
    const self = join(APP_DIR, 'shared/components/skeleton/skeleton.component.html');
    const offenders = TEMPLATES.filter(
      (f) => f.path !== self && /class="skeleton-list[\s"]/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
