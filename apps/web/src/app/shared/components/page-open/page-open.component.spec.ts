import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import { PageOpenComponent } from './page-open.component';

@Component({
  imports: [PageOpenComponent],
  template: `<app-page-open
    [nameSize]="big()"
    [subLarge]="large()"
    [compact]="small()"
    [titleSwap]="swapTitle()"
    ><ng-container openTitle>王柏翰</ng-container
    ><ng-container openSub>副行</ng-container></app-page-open
  >`,
})
class Host {
  readonly big = signal(false);
  readonly large = signal(false);
  readonly small = signal(false);
  readonly swapTitle = signal(true);
}

describe('PageOpenComponent 標題字級', () => {
  const h1 = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('h1')!;

  it('預設是一般標題 48／28（別頁不受影響）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(h1(f).classList.contains('wide:text-[48px]')).toBe(true);
    expect(h1(f).classList.contains('wide:text-[72px]')).toBe(false);
  });

  // 稿的手機 `.open__title` 行高 1.2 蓋過 `--name` 的 1（#1925 conformance 量到）
  it('nameSize：人名標題桌機 72／行高 1，手機 44／行高 1.2', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.big.set(true);
    f.detectChanges();
    expect(h1(f).classList.contains('wide:text-[72px]')).toBe(true);
    expect(h1(f).classList.contains('text-[44px]')).toBe(true);
    expect(h1(f).classList.contains('leading-[1.2]')).toBe(true);
    expect(h1(f).classList.contains('wide:leading-none')).toBe(true);
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

  // 課表（A6 schedule.css:10-11,277）：標題 40／26、桌機內距上 32／下 24；預設關，別頁不變
  describe('compact（課表色面）', () => {
    const wrap = (f: { nativeElement: HTMLElement }) =>
      f.nativeElement.querySelector('section > div.page-wrap') as HTMLElement;

    it('預設關：48／28、內距上 48／下 40；開了：40／26、上 32／下 24（手機也是）', () => {
      const f = TestBed.createComponent(Host);
      f.detectChanges();
      expect(h1(f).classList.contains('wide:text-[48px]')).toBe(true);
      expect(h1(f).classList.contains('wide:text-[40px]')).toBe(false);
      expect(wrap(f).classList.contains('wide:pt-12')).toBe(true);
      expect(wrap(f).classList.contains('wide:pb-10')).toBe(true);

      f.componentInstance.small.set(true);
      f.detectChanges();
      expect(h1(f).classList.contains('wide:text-[40px]')).toBe(true);
      expect(h1(f).classList.contains('text-[26px]')).toBe(true);
      expect(h1(f).classList.contains('wide:text-[48px]')).toBe(false);
      expect(wrap(f).classList.contains('pt-8')).toBe(true); // A6 schedule.css:10 沒有媒體查詢，手機也是 32／24
      expect(wrap(f).classList.contains('pb-6')).toBe(true);
      expect(wrap(f).classList.contains('wide:pt-12')).toBe(false);
    });

    it('人名標題（nameSize）優先：就算 compact 也是 72／44', () => {
      const f = TestBed.createComponent(Host);
      f.componentInstance.big.set(true);
      f.componentInstance.small.set(true);
      f.detectChanges();
      expect(h1(f).classList.contains('wide:text-[72px]')).toBe(true);
      expect(h1(f).classList.contains('wide:text-[40px]')).toBe(false);
    });
  });
});

describe('PageOpenComponent 色面高度用滑的（#1859）', () => {
  it('色面掛 appHeightFollow（#1861 的共用 directive，不另起一支）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(f.nativeElement.querySelector('section[appheightfollow]')).not.toBeNull();
  });
});

describe('PageOpenComponent 色面句換字（#1895）', () => {
  it('標題 h1 與副行 p 都掛 appTextSwap（一處掛、全站色面句生效）', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    for (const sel of ['h1', 'p']) {
      const el = f.debugElement.query(By.css(`app-page-open ${sel}`));
      expect(el.injector.get(TextSwapDirective, null), sel).not.toBeNull();
    }
  });
});

describe('PageOpenComponent 標題可關掉換字（使用者 10-23：儀表板的補習班名稱不要動畫）', () => {
  const swapOf = (f: ReturnType<typeof TestBed.createComponent<Host>>, sel: string) =>
    f.debugElement.query(By.css(`app-page-open ${sel}`)).injector.get(TextSwapDirective);

  it('預設標題與副行都開', () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    expect(swapOf(f, 'h1').enabled()).toBe(true);
    expect(swapOf(f, 'p').enabled()).toBe(true);
  });

  it('titleSwap=false：只關標題，副行照舊', () => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.swapTitle.set(false);
    f.detectChanges();
    expect(swapOf(f, 'h1').enabled()).toBe(false);
    expect(swapOf(f, 'p').enabled()).toBe(true);
  });
});
