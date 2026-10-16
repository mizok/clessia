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

  // #1665 公開表單：表單欄位要 A6 `.acset__l` 的字級、必填星號、驗證沒過的紅框；預設都不變（篩選列照舊）
  it('預設：標籤 sm、沒有星號、沒有紅框', async () => {
    const { fixture, select } = await setup(opts(3));
    const label = fixture.nativeElement.querySelector(`#${select.ariaLabelledBy}`) as HTMLElement;
    expect(label.classList).toContain('text-sm');
    expect(label.textContent).not.toContain('*');
    expect(
      JSON.stringify((fixture.componentInstance as unknown as { pt: () => unknown }).pt()),
    ).not.toContain('border-error-700');
  });

  it('labelSize md、required、invalid：字級 md、星號 aria-hidden、框換錯誤色', async () => {
    const { fixture } = await setup(opts(3));
    fixture.componentRef.setInput('labelSize', 'md');
    fixture.componentRef.setInput('required', true);
    fixture.componentRef.setInput('invalid', true);
    fixture.detectChanges();
    const select = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
    const label = fixture.nativeElement.querySelector(`#${select.ariaLabelledBy}`) as HTMLElement;

    expect(label.classList).toContain('text-md');
    expect(label.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('*');
    expect(
      JSON.stringify((fixture.componentInstance as unknown as { pt: () => unknown }).pt()),
    ).toContain('border-error-700');
  });
});
