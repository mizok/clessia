import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReloadVeilComponent } from './reload-veil.component';

@Component({
  imports: [ReloadVeilComponent],
  template: `
    <app-reload-veil [loading]="loading()">
      <div reloadSkeleton data-testid="skeleton">骨架</div>
      <p data-testid="content">{{ data() }}</p>
    </app-reload-veil>
  `,
})
class HostComponent {
  readonly loading = signal(true);
  readonly data = signal('舊資料');
}

describe('ReloadVeilComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const q = (sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement | null;
    const step = (loading: boolean) => {
      fixture.componentInstance.loading.set(loading);
      fixture.detectChanges();
      fixture.detectChanges();
    };
    return { fixture, q, step };
  }

  it('第一次載入：只有骨架', () => {
    const { q } = setup();
    expect(q('[data-testid="skeleton"]')).not.toBeNull();
    expect(q('[data-testid="content"]')).toBeNull();
  });

  it('載入完成：內容出現、沒有變淡', () => {
    const { q, step } = setup();
    step(false);
    expect(q('[data-testid="skeleton"]')).toBeNull();
    expect(q('[data-testid="content"]')?.textContent).toBe('舊資料');
    expect(q('.reload-veil--stale')).toBeNull();
    expect(q('[role="status"]')).toBeNull();
  });

  it('重抓：舊內容留著並變淡、標 aria-busy、頂端寫「載入中」，不回到骨架', () => {
    const { q, step } = setup();
    step(false);
    step(true);
    expect(q('[data-testid="skeleton"]')).toBeNull();
    expect(q('[data-testid="content"]')?.textContent).toBe('舊資料');
    expect(q('.reload-veil--stale')?.getAttribute('aria-busy')).toBe('true');
    expect(q('[role="status"]')?.textContent).toContain('載入中');
  });

  it('重抓完成：變淡拿掉', () => {
    const { q, step } = setup();
    step(false);
    step(true);
    step(false);
    expect(q('.reload-veil--stale')).toBeNull();
    expect(q('.reload-veil')?.hasAttribute('aria-busy')).toBe(false);
  });
});
