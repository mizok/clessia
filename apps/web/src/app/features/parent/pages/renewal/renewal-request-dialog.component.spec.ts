import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { ParentRenewalService, type ParentRenewalItem } from '@core/parent-renewal.service';
import { RenewalRequestDialogComponent } from './renewal-request-dialog.component';

/**
 * #1122 申請異動表單的行為：送出中不讓關（Esc／背景／取消都擋）、連按只送一次。
 * dialog 先真的開起來（正控），「沒關」的斷言才分得出有沒有修。
 */

const item = (enrollmentId: string, nextClassName: string): ParentRenewalItem => ({
  enrollmentId,
  courseName: null,
  currentClassName: nextClassName,
  nextClassName,
  upgraded: false,
  schedules: [],
  teacherNames: [],
  estimatedAmount: null,
  estimateSource: null,
});

async function setup() {
  // 無條件換掉：環境自帶的 showModal 不一定設 open（#2473 CI）
  (HTMLDialogElement.prototype as any).showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  (HTMLDialogElement.prototype as any).close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  const pending = new Subject<unknown>();
  const createRequest = vi.fn(() => pending);
  TestBed.configureTestingModule({
    imports: [RenewalRequestDialogComponent],
    providers: [
      { provide: ParentRenewalService, useValue: { createRequest } },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(RenewalRequestDialogComponent);
  const cmp = fixture.componentInstance as any;
  const closed = vi.fn();
  cmp.closed.subscribe(closed);
  // 只有一門課 → 預選；再填「想怎麼改」就能送
  cmp.open({ id: 'kid-1', name: '林子晴' }, [item('e1', '國二數學 A')], '2027-02-01');
  fixture.detectChanges();
  await fixture.whenStable(); // showModal 在 afterNextRender 裡
  cmp.detail.set('下期改週六');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const dialog = el.querySelector('dialog')!;
  return { fixture, cmp, el, dialog, pending, createRequest, closed };
}

describe('RenewalRequestDialogComponent（#1122）', () => {
  it('送出中按 Esc／點背景／按取消、✕ 都不關；回來後照樣關窗並回報送出成功', async () => {
    const { fixture, cmp, el, dialog, pending, createRequest, closed } = await setup();
    expect(dialog.hasAttribute('open')).toBe(true); // 正控
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(createRequest).toHaveBeenCalledTimes(1);

    const esc = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 點背景（target 是 dialog 本身）
    cmp.close(); // ✕ 與取消都走這裡
    fixture.detectChanges();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(closed).not.toHaveBeenCalled();

    pending.next({});
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('連按送出兩次只打一次 API（送出鈕指回 form、不綁 click；送出中擋重送）', async () => {
    const { el, cmp, dialog, createRequest } = await setup();
    expect(dialog.hasAttribute('open')).toBe(true);
    const submit = el.querySelector<HTMLButtonElement>('[data-testid="renewal-submit"]')!;
    // 按一下只走 form 的 submit 一條路：鈕另外綁 click 的話 save 會被叫兩次（API 被守門擋成一次，看不出來）
    const save = vi.spyOn(cmp, 'save');
    submit.click();
    expect(save).toHaveBeenCalledTimes(1);
    submit.click();
    expect(createRequest).toHaveBeenCalledTimes(1);
  });
});
