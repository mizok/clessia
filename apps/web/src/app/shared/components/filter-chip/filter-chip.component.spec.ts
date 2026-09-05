import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FilterChipComponent } from './filter-chip.component';

@Component({
  selector: 'app-filter-chip-host',
  imports: [FilterChipComponent],
  template: `
    <app-filter-chip [active]="active" [icon]="icon" (toggle)="onToggle()">{{
      label
    }}</app-filter-chip>
  `,
})
class HostComponent {
  active = false;
  icon: string | undefined;
  label = '只看未簽收';
  toggleCount = 0;
  onToggle(): void {
    this.toggleCount++;
  }
}

describe('FilterChipComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('渲染投影進來的文字', () => {
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.textContent).toContain('只看未簽收');
  });

  it('未啟用時 aria-pressed 是 false，沒有 active class', () => {
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.classList).not.toContain('filter-chip--active');
  });

  it('啟用時 aria-pressed 是 true，且有視覺上的 active class', () => {
    host.active = true;
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList).toContain('filter-chip--active');
  });

  it('點擊會發出 toggle 事件', () => {
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.click();
    expect(host.toggleCount).toBe(1);
  });

  it('icon 有指定時渲染圖示', () => {
    host.icon = 'pi-inbox';
    fixture.detectChanges();
    const icon: HTMLElement | null = fixture.nativeElement.querySelector('.filter-chip__icon');
    expect(icon).not.toBeNull();
    expect(icon!.className).toContain('pi-inbox');
  });

  it('icon 沒指定時不渲染圖示元素', () => {
    fixture.detectChanges();
    const icon: HTMLElement | null = fixture.nativeElement.querySelector('.filter-chip__icon');
    expect(icon).toBeNull();
  });
});
