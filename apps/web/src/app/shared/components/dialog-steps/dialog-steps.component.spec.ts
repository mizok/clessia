import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { DialogStepsComponent, dialogStepsActive } from './dialog-steps.component';

@Component({
  imports: [DialogStepsComponent],
  template: `<app-dialog-steps [current]="2" [total]="3" label="計費" />`,
})
class HostComponent {}

describe('DialogStepsComponent（#2396）', () => {
  it('寫「第 2／3 步 · 計費」，只在手機顯示、換步會報讀', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const p = (fixture.nativeElement as HTMLElement).querySelector('p')!;
    expect(p.textContent!.replace(/\s+/g, ' ').trim()).toBe('第 2／3 步 · 計費');
    expect(p.classList).toContain('wide:hidden');
    expect(p.getAttribute('aria-live')).toBe('polite');
  });

  it('dialogStepsActive：≤860 才算分步；沒有 matchMedia（SSR／測試環境）當桌機', () => {
    expect(dialogStepsActive()).toBe(false);
    const mm = vi.fn((q: string) => ({ matches: q === '(max-width: 860px)' }));
    vi.stubGlobal('matchMedia', mm);
    expect(dialogStepsActive()).toBe(true);
    mm.mockReturnValue({ matches: false });
    expect(dialogStepsActive()).toBe(false);
    vi.unstubAllGlobals();
  });
});
