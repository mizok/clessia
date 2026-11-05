import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DialogFrameComponent } from './dialog-frame.component';

@Component({
  imports: [DialogFrameComponent],
  template: `
    <div role="dialog">
      <app-dialog-frame title="拆時段" [sub]="sub" (closed)="closedCount = closedCount + 1">
        <p data-body>內容</p>
        @if (withFoot) {
          <ng-container dialogFoot><button type="button">確定</button></ng-container>
        }
      </app-dialog-frame>
    </div>
  `,
})
class HostComponent {
  sub = '';
  withFoot = true;
  closedCount = 0;
}

describe('DialogFrameComponent', () => {
  async function setup(patch: Partial<HostComponent> = {}) {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    Object.assign(fixture.componentInstance, patch);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('標頭只有 h2、（副標）、關閉鈕；h2 是外層 dialog 的可及名稱', async () => {
    const { el } = await setup({ sub: '原本的時段上到 12/31' });
    const head = el.querySelector('.dialog-header-inline')!;
    expect([...head.querySelectorAll('h2, p, button')].map((e) => e.tagName)).toEqual([
      'H2',
      'P',
      'BUTTON',
    ]);
    const h2 = head.querySelector('h2')!;
    expect(h2.textContent?.trim()).toBe('拆時段');
    expect(el.querySelector('[role=dialog]')?.getAttribute('aria-labelledby')).toBe(h2.id);
    expect(head.querySelector('button')?.getAttribute('aria-label')).toBe('關閉');
  });

  it('沒給副標就不渲染', async () => {
    const { el } = await setup();
    expect(el.querySelector('.dialog-header-inline__sub')).toBeNull();
  });

  it('按關閉發出 closed', async () => {
    const { el, fixture } = await setup();
    el.querySelector<HTMLButtonElement>('.dialog-header-inline__close')!.click();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('內容投影進 body、底部的鈕投影進 sticky 底部列', async () => {
    const { el } = await setup();
    expect(el.querySelector('.dialog-frame__body [data-body]')).not.toBeNull();
    expect(el.querySelector('.form-dialog__footer button')?.textContent).toBe('確定');
  });

  // 底部列沒有子元素時由 styles.css 的 `.form-dialog__footer:not(:has(*))` 藏起來
  //（不用 :empty —— @if 的錨點註解、空白文字都可能留在裡面）
  it('沒有底部的鈕：底部列沒有任何子元素', async () => {
    const { el } = await setup({ withFoot: false });
    expect(el.querySelector('.form-dialog__footer')!.children.length).toBe(0);
  });
});
