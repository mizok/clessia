import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusDotComponent, type StatusTone } from './status-dot.component';

@Component({
  imports: [StatusDotComponent],
  template: `<app-status-dot [tone]="tone()">已點名</app-status-dot>`,
})
class HostComponent {
  readonly tone = signal<StatusTone>('done');
}

describe('StatusDotComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  const root = () => fixture.nativeElement.querySelector('.status-dot');

  it('should create', () => {
    expect(root()).toBeTruthy();
  });

  // 不靠顏色單獨傳達語意（WCAG 1.4.1）—— 點是裝飾，語意在文字上
  it('點對輔助科技隱藏，語意由文字承載', () => {
    expect(root().querySelector('.status-dot__mark').getAttribute('aria-hidden')).toBe('true');
    expect(root().querySelector('.status-dot__label').textContent.trim()).toBe('已點名');
  });

  it('五個 tone 都對應到自己的 modifier', async () => {
    const tones: StatusTone[] = ['done', 'pending', 'overdue', 'failed', 'inactive'];

    for (const tone of tones) {
      fixture.componentInstance.tone.set(tone);
      await fixture.whenStable();

      expect(root().classList.contains(`status-dot--${tone}`)).toBe(true);
    }
  });

  // BEM：block 與 modifier 必須在同一個元素上，樣式才咬得住
  it('block 與 modifier 在同一個元素上', () => {
    expect(root().classList.contains('status-dot')).toBe(true);
    expect(root().classList.contains('status-dot--done')).toBe(true);
  });
});
