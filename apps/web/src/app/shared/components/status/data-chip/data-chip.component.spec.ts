import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DataChipComponent } from './data-chip.component';

@Component({
  imports: [DataChipComponent],
  template: `<app-data-chip>校內考</app-data-chip>`,
})
class HostComponent {}

describe('DataChipComponent', () => {
  it('把身分標籤原樣渲染出來', async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.data-chip').textContent.trim()).toBe('校內考');
  });

  // 這一支刻意沒有 severity —— 沒有那個參數，就沒有人會拿它表達狀態
  it('沒有 severity / tone 之類的參數', () => {
    const inputs = Object.keys(new DataChipComponent() as object);

    expect(inputs).toEqual([]);
  });
});
