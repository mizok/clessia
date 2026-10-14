import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PageOpenComponent } from './page-open.component';

@Component({
  imports: [PageOpenComponent],
  template: `<app-page-open [nameSize]="big()"
    ><ng-container openTitle>王柏翰</ng-container></app-page-open
  >`,
})
class Host {
  readonly big = signal(false);
}

describe('PageOpenComponent 標題字級', () => {
  const h1 = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('h1')!;

  it('預設是一般標題 48／28（別頁不受影響）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(h1(f).classList.contains('wide:text-[48px]')).toBe(true);
    expect(h1(f).classList.contains('wide:text-[72px]')).toBe(false);
  });

  it('nameSize：人名標題桌機 72／手機 44，行高 1', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.big.set(true);
    f.detectChanges();
    expect(h1(f).classList.contains('wide:text-[72px]')).toBe(true);
    expect(h1(f).classList.contains('text-[44px]')).toBe(true);
    expect(h1(f).classList.contains('leading-none')).toBe(true);
    expect(h1(f).classList.contains('wide:text-[48px]')).toBe(false);
  });
});
