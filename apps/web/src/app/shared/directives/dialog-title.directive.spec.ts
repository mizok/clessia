import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogTitleDirective } from './dialog-title.directive';

@Component({
  imports: [DialogTitleDirective],
  template: `<div role="dialog"><h2 appDialogTitle>新增課程</h2></div>`,
})
class HostComponent {}

describe('DialogTitleDirective', () => {
  it('外層 role=dialog 的 aria-labelledby 指到這個標題', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const h2 = el.querySelector('h2')!;
    expect(h2.id).toMatch(/^dialog-title-\d+$/);
    expect(el.querySelector('[role="dialog"]')!.getAttribute('aria-labelledby')).toBe(h2.id);
  });
});
