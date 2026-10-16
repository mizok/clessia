import { TestBed } from '@angular/core/testing';
import { Select } from 'primeng/select';
import { By } from '@angular/platform-browser';

import { SelectFieldComponent, type SelectFieldOption } from './select-field.component';

const opts = (n: number): SelectFieldOption<string>[] =>
  Array.from({ length: n }, (_, i) => ({ label: `選項 ${i}`, value: `v${i}` }));

async function setup(options: SelectFieldOption<string>[], value: string | null = null) {
  await TestBed.configureTestingModule({ imports: [SelectFieldComponent] }).compileComponents();
  const fixture = TestBed.createComponent(SelectFieldComponent<string>);
  fixture.componentRef.setInput('label', '月份');
  fixture.componentRef.setInput('options', options);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  await fixture.whenStable();
  const select = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
  return { fixture, select };
}

describe('SelectFieldComponent', () => {
  // A6：選項少的時候搜尋框只是多一個要跳過的東西
  it('8 項以內沒有搜尋框，超過 8 項才有', async () => {
    expect((await setup(opts(8))).select.filter).toBe(false);
    TestBed.resetTestingModule();
    expect((await setup(opts(9))).select.filter).toBe(true);
  });

  it('看得到的標籤就是讀屏名稱（aria-labelledby 指向它）', async () => {
    const { fixture, select } = await setup(opts(3));
    const label = fixture.nativeElement.querySelector(`#${select.ariaLabelledBy}`);
    expect(label?.textContent.trim()).toBe('月份');
  });

  it('選了之後 value 回寫，外面拿得到', async () => {
    const { fixture, select } = await setup(opts(3), 'v0');
    const changes: (string | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => changes.push(v));

    select.onModelChange('v2');
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('v2');
    expect(changes).toContain('v2');
  });

  /**
   * PrimeNG 對 appendTo 給元素時用的是 absolutePosition（整份文件的座標），但原生 modal
   * `<dialog>` 是 fixed 定位的容器 —— 面板會多偏移一個「dialog 在畫面上的位置」。
   * 通知中心的發送彈窗（#1689）在桌機實測：面板掉到觸發鈕下方約 200px（＝dialog 的 top）。
   */
  describe('掛在容器上時，面板座標換成相對容器（#1689）', () => {
    function showWith(appendTo: 'body' | HTMLElement, modal = false) {
      return setup(opts(3)).then(({ fixture, select }) => {
        fixture.componentRef.setInput('appendTo', appendTo);
        fixture.detectChanges();
        const overlayEl = document.createElement('div');
        overlayEl.style.top = '670px';
        overlayEl.style.insetInlineStart = '364px';
        // 假的 alignOverlay＝PrimeNG 的 absolutePosition：每次都寫回文件座標
        const overlay = {
          modal,
          overlayEl,
          alignOverlay: () => {
            overlayEl.style.top = '670px';
            overlayEl.style.insetInlineStart = '364px';
          },
        };
        (select as unknown as { overlayViewChild: unknown }).overlayViewChild = overlay;
        select.onShow.emit({} as never);
        return Object.assign(overlayEl, {
          realign: () => overlay.alignOverlay(),
          // 關掉再打開：p-overlay 實例一直留著，PrimeNG 每次打開都先在 beforeEnter alignOverlay、再發 onShow
          reopen: () => {
            overlay.alignOverlay();
            select.onShow.emit({} as never);
          },
        });
      });
    }

    function dialogAt(top: number, left: number, scrollTop = 0): HTMLElement {
      const container = document.createElement('dialog');
      container.getBoundingClientRect = () => ({ top, left }) as DOMRect;
      Object.defineProperty(container, 'scrollTop', { value: scrollTop });
      return container;
    }

    it('扣掉容器在畫面上的位置（加回容器自己的捲動）', async () => {
      const overlay = await showWith(dialogAt(198, 340, 10));

      expect(overlay.style.top).toBe('482px');
      expect(overlay.style.insetInlineStart).toBe('24px');
    });

    // 打字篩選時 PrimeNG 會再 alignOverlay 一次；只在打開時換一次的話會被蓋回去
    it('PrimeNG 重新定位（打字篩選）之後仍然相對容器', async () => {
      const overlay = await showWith(dialogAt(198, 340));
      overlay.realign();

      expect(overlay.style.top).toBe('472px');
      expect(overlay.style.insetInlineStart).toBe('24px');
    });

    // #1697 二讀抓到：第二次打開時 wrapper 已經換過一次，onShow 不能再換（不然扣兩次：472 → 274）
    it('關掉再打開：座標只換一次', async () => {
      const overlay = await showWith(dialogAt(198, 340));
      overlay.reopen();

      expect(overlay.style.top).toBe('472px');
      expect(overlay.style.insetInlineStart).toBe('24px');

      overlay.reopen();
      expect(overlay.style.top).toBe('472px');
    });

    it('掛在 body 時不動', async () => {
      const overlay = await showWith('body');

      expect(overlay.style.top).toBe('670px');
      expect(overlay.style.insetInlineStart).toBe('364px');
    });

    // ≤860 是 PrimeNG 的 modal 底部面板，不走 absolutePosition，自然不用換
    it('手機底部面板（modal）不動', async () => {
      const overlay = await showWith(dialogAt(198, 340), true);

      expect(overlay.style.top).toBe('670px');
    });
  });

  // #1665 公開表單：表單欄位要 A6 `.acset__l` 的字級、必填星號、驗證沒過的紅框；預設都不變（篩選列照舊）
  it('預設：標籤 sm、沒有星號、沒有紅框', async () => {
    const { fixture, select } = await setup(opts(3));
    const label = fixture.nativeElement.querySelector(`#${select.ariaLabelledBy}`) as HTMLElement;
    expect(label.classList).toContain('text-sm');
    expect(label.textContent).not.toContain('*');
    expect(
      JSON.stringify((fixture.componentInstance as unknown as { pt: () => unknown }).pt()),
    ).not.toContain('border-error-700');
  });

  it('labelSize md、required、invalid：字級 md、星號 aria-hidden、框換錯誤色', async () => {
    const { fixture } = await setup(opts(3));
    fixture.componentRef.setInput('labelSize', 'md');
    fixture.componentRef.setInput('required', true);
    fixture.componentRef.setInput('invalid', true);
    fixture.detectChanges();
    const select = fixture.debugElement.query(By.directive(Select)).componentInstance as Select;
    const label = fixture.nativeElement.querySelector(`#${select.ariaLabelledBy}`) as HTMLElement;

    expect(label.classList).toContain('text-md');
    expect(label.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('*');
    expect(
      JSON.stringify((fixture.componentInstance as unknown as { pt: () => unknown }).pt()),
    ).toContain('border-error-700');
  });
});
