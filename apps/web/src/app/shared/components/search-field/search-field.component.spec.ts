import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { SearchFieldComponent } from './search-field.component';

describe('SearchFieldComponent', () => {
  let fixture: ComponentFixture<SearchFieldComponent>;
  const emitted: string[] = [];
  // timetravel 的 setup 在 top-level 就把時鐘換成假的：收尾時不能無條件 useRealTimers（會污染後面的測試）
  const alreadyFake = vi.isFakeTimers();

  beforeEach(() => {
    emitted.length = 0;
    vi.useFakeTimers();
    fixture = TestBed.createComponent(SearchFieldComponent);
    fixture.componentRef.setInput('label', '老師或班級');
    fixture.componentInstance.searchChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
  });
  afterEach(() => {
    if (!alreadyFake) vi.useRealTimers();
  });

  const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
  const type = (text: string, init: InputEventInit = {}) => {
    input().value = text;
    input().dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
  };

  it('停手 300ms 才送一次，連打只送最後一個，前後空白修掉', () => {
    type('王');
    vi.advanceTimersByTime(200);
    type(' 王老師 ');
    vi.advanceTimersByTime(299);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual(['王老師']);
  });

  it('輸入法組字中不送，compositionend 才送', () => {
    type('ㄨㄤ', { isComposing: true });
    vi.advanceTimersByTime(500);
    expect(emitted).toEqual([]);

    input().value = '王';
    input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(emitted).toEqual(['王']);
  });

  it('跟目前生效的查詢相同就不送；外部把 value 清空，輸入框跟著清空', () => {
    fixture.componentRef.setInput('value', '王');
    fixture.detectChanges();
    expect(input().value).toBe('王');

    type('王');
    vi.advanceTimersByTime(300);
    expect(emitted).toEqual([]);

    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
    expect(input().value).toBe('');
  });

  it('標籤與輸入框用 for/id 連起來', () => {
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(input().id);
    expect(label.textContent).toContain('老師或班級');
  });
});
