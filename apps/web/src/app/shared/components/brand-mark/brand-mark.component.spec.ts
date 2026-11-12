import { TestBed } from '@angular/core/testing';
import { BrandMarkComponent } from './brand-mark.component';

describe('BrandMarkComponent', () => {
  it('畫三段圓弧、對讀屏隱藏、顏色走 CSS 變數', async () => {
    await TestBed.configureTestingModule({ imports: [BrandMarkComponent] }).compileComponents();
    const el: HTMLElement = TestBed.createComponent(BrandMarkComponent).nativeElement;
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path').length).toBe(3);
    expect(svg.innerHTML).toContain('var(--mark-cream');
    expect(svg.innerHTML).toContain('var(--mark-orange');
  });
});
