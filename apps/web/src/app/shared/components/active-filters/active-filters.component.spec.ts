import { TestBed } from '@angular/core/testing';
import { ActiveFiltersComponent, type ActiveFilter } from './active-filters.component';

function mount(filters: ActiveFilter[]) {
  const fixture = TestBed.createComponent(ActiveFiltersComponent);
  fixture.componentRef.setInput('filters', filters);
  fixture.detectChanges();
  const removed: string[] = [];
  fixture.componentInstance.removed.subscribe((k) => removed.push(k));
  return { el: fixture.nativeElement as HTMLElement, removed };
}

describe('ActiveFiltersComponent（#2206）', () => {
  it('沒有條件時整個不渲染（不佔高度）', () => {
    const { el } = mount([]);
    expect(el.querySelector('ul')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });

  it('一個條件一顆原生按鈕，名稱說清楚是「移除」、手機 44px、桌機隱藏', () => {
    const { el } = mount([
      { key: 'grade', label: '國三' },
      { key: 'status', label: '已停用' },
    ]);
    const list = el.querySelector('ul')!;
    expect(list.getAttribute('aria-label')).toBe('已套用的篩選');
    expect(list.classList.contains('wide:hidden')).toBe(true);
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      '移除篩選：國三',
      '移除篩選：已停用',
    ]);
    expect(buttons.every((b) => b.type === 'button' && b.classList.contains('min-h-11'))).toBe(
      true,
    );
  });

  it('點了發出那個條件的 key', () => {
    const { el, removed } = mount([{ key: 'grade', label: '國三' }]);
    el.querySelector('button')!.click();
    expect(removed).toEqual(['grade']);
  });
});
