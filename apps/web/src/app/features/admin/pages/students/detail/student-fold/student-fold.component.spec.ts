import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { StudentFoldComponent } from './student-fold.component';

describe('StudentFoldComponent', () => {
  // #1705：A6 `.coll` 共用樣式；學生檔案的摺疊列（含帳單章）同一組，一次只開一個
  it('是 details.coll，name 跟帳單章同一組；標題與摘要在 coll__sum 裡', async () => {
    await TestBed.configureTestingModule({ imports: [StudentFoldComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StudentFoldComponent);
    fixture.componentRef.setInput('title', '成績');
    fixture.componentRef.setInput('meta', '3 科');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const details = el.querySelector('details.coll')!;
    expect(details.getAttribute('name')).toBe('student-folds');
    expect(details.querySelector('.coll__sum .coll__t')?.textContent?.trim()).toBe('成績');
    expect(details.querySelector('.coll__sum .coll__m')?.textContent?.trim()).toBe('3 科');
    expect(details.querySelector(':scope > .coll__body')).not.toBeNull();
  });

  // #1983：摘要是資料回來才算出來的，換字走 appTextSwap
  describe('摘要換字（#1983）', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    });

    async function setup(reduce = false) {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));
      const animated: HTMLElement[] = [];
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
        this: HTMLElement,
      ) {
        animated.push(this);
        return { cancel: vi.fn(), finished: new Promise(() => undefined) };
      };
      await TestBed.configureTestingModule({ imports: [StudentFoldComponent] }).compileComponents();
      const fixture = TestBed.createComponent(StudentFoldComponent);
      fixture.componentRef.setInput('title', '成績');
      fixture.componentRef.setInput('meta', '3 科');
      fixture.detectChanges();
      await fixture.whenStable();
      const meta = async (m: string) => {
        fixture.componentRef.setInput('meta', m);
        fixture.detectChanges();
        await Promise.resolve(); // MutationObserver 回呼
        await Promise.resolve(); // 合成一次換字的 microtask
      };
      const host = (fixture.nativeElement as HTMLElement).querySelector('.coll__m')!;
      return { animated, meta, host };
    }

    it('值變了會播：宿主進場', async () => {
      const { animated, meta, host } = await setup();
      await meta('4 科');
      expect(animated).toContain(host);
    });

    it('值沒變不播', async () => {
      const { animated, meta } = await setup();
      await meta('3 科');
      expect(animated).toHaveLength(0);
    });

    it('減少動態不播', async () => {
      const { animated, meta } = await setup(true);
      await meta('4 科');
      expect(animated).toHaveLength(0);
    });
  });
});
