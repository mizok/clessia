import { TestBed } from '@angular/core/testing';
import { Select } from 'primeng/select';
import { By } from '@angular/platform-browser';

import { SelectFieldComponent, type SelectFieldOption } from './select-field.component';

const opts = (n: number): SelectFieldOption<string>[] =>
  Array.from({ length: n }, (_, i) => ({ label: `選項 ${i}`, value: `v${i}` }));

async function setup(options: SelectFieldOption<string>[], value: string | null = null) {
  await TestBed.configureTestingModule({ imports: [SelectFieldComponent] }).compileComponents();
  const fixture = TestBed.createComponent(SelectFieldComponent<string>);
  fixture.componentRef.setInput('label', '月份');
  fixture.componentRef.setInput('options', options);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  await fixture.whenStable();
  const select = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
  return { fixture, select };
}

describe('SelectFieldComponent', () => {
  // A6：選項少的時候搜尋框只是多一個要跳過的東西
  it('8 項以內沒有搜尋框，超過 8 項才有', async () => {
    expect((await setup(opts(8))).select.filter).toBe(false);
    TestBed.resetTestingModule();
    expect((await setup(opts(9))).select.filter).toBe(true);
  });

  it('看得到的標籤就是讀屏名稱（aria-labelledby 指向它）', async () => {
    const { fixture, select } = await setup(opts(3));
    const label = fixture.nativeElement.querySelector(`#${select.ariaLabelledBy}`);
    expect(label?.textContent.trim()).toBe('月份');
  });

  it('選了之後 value 回寫，外面拿得到', async () => {
    const { fixture, select } = await setup(opts(3), 'v0');
    const changes: (string | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => changes.push(v));

    select.onModelChange('v2');
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('v2');
    expect(changes).toContain('v2');
  });
});
