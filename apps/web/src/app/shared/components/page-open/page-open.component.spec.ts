import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PageOpenComponent } from './page-open.component';

@Component({
  imports: [PageOpenComponent],
  template: `<app-page-open [nameSize]="big()" [subLarge]="large()"
    ><ng-container openTitle>王柏翰</ng-container
    ><ng-container openSub>副行</ng-container></app-page-open
  >`,
})
class Host {
  readonly big = signal(false);
  readonly large = signal(false);
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

  const sub = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('h1 + p')!;

  it('subLarge 預設關：副行一般大小；開了才放大（A6 a6.css:633）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(sub(f).classList.contains('wide:text-lg')).toBe(true);
    expect(sub(f).classList.contains('wide:text-2xl')).toBe(false);

    f.componentInstance.large.set(true);
    f.detectChanges();
    expect(sub(f).classList.contains('wide:text-2xl')).toBe(true);
    expect(sub(f).classList.contains('font-semibold')).toBe(true);
    expect(sub(f).classList.contains('wide:text-lg')).toBe(false);
  });
});
