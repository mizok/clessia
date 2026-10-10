import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FilterToggleComponent } from './filter-toggle.component';

describe('FilterToggleComponent', () => {
  let fixture: ComponentFixture<FilterToggleComponent>;
  let host: HTMLElement;
  const button = () => host.querySelector('button') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterToggleComponent] }).compileComponents();
    fixture = TestBed.createComponent(FilterToggleComponent);
    fixture.componentRef.setInput('controls', 'x-filters');
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('預設寫「篩選：全部」，有條件時寫條件摘要', () => {
    expect(button().textContent).toContain('篩選：全部');

    fixture.componentRef.setInput('summary', '已逾期');
    fixture.detectChanges();
    expect(button().textContent).toContain('篩選：已逾期');
  });

  it('點一下開、再點一下關，aria-expanded 跟著走、aria-controls 指到面板', () => {
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().getAttribute('aria-controls')).toBe('x-filters');

    button().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');

    button().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('active 時多一個點，收起來也看得出有條件在濾', () => {
    expect(host.querySelector('.filter-toggle__dot')).toBeNull();

    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    expect(host.querySelector('.filter-toggle__dot')).not.toBeNull();
  });

  it('桌機不渲染：宿主帶 wide:hidden（桌機的控制項本來就攤開）', () => {
    expect(host.classList.contains('wide:hidden')).toBe(true);
  });

  it('鈕高 ≥44px（A27 的 class 版）', () => {
    expect(button().classList.contains('h-11')).toBe(true);
  });
});
