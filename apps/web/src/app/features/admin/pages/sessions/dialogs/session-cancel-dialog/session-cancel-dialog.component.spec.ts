import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SessionsService, type Session } from '@core/sessions.service';
import { SessionCancelDialogComponent } from './session-cancel-dialog.component';

const session = {
  id: 's1',
  className: '數學A',
  teacherName: '王老師',
  sessionDate: '2026-03-07',
  startTime: '09:00',
  endTime: '11:00',
} as Session;

/** 共用殼（#2290）：停課的 h2、底部鈕、✕ —— 四支課堂動作對話框同一個形狀，這支代表 */
describe('SessionCancelDialogComponent', () => {
  function setup() {
    const close = vi.fn();
    const cancel = vi.fn(() => of({}));
    TestBed.configureTestingModule({
      imports: [SessionCancelDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { session } } },
        { provide: SessionsService, useValue: { cancel } },
      ],
    });
    const fixture = TestBed.createComponent(SessionCancelDialogComponent);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, close, cancel };
  }

  it('標題「停課」在殼的 h2；確認鈕在底部列，按了送出並帶回 refresh', () => {
    const { el, close, cancel } = setup();

    expect(el.querySelector('h2')?.textContent?.trim()).toBe('停課');
    const submit = el.querySelector<HTMLButtonElement>(
      '.form-dialog__footer [data-testid="op-submit"]',
    );
    expect(submit?.textContent).toContain('確認停課');
    submit!.click();
    // 底部鈕是 type=submit＋form 指回表單，只走 (ngSubmit) 一條路：點一次只送一次
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('s1', undefined);
    expect(close).toHaveBeenCalledWith({ result: 'refresh', session });
  });

  it('鈕在 form 外（殼的底部列），仍是這張表單的送出鈕；在欄位按 Enter（隱式送出）只送一次', () => {
    const { el, cancel } = setup();
    const form = el.querySelector('form')!;
    const submit = el.querySelector<HTMLButtonElement>('[data-testid="op-submit"]')!;

    expect(form.contains(submit)).toBe(false);
    expect(submit.form).toBe(form);
    form.requestSubmit(); // 瀏覽器在欄位按 Enter 走的就是這條路
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('✕ 關窗、不送出', () => {
    const { el, close, cancel } = setup();

    el.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click();
    expect(close).toHaveBeenCalledWith();
    expect(cancel).not.toHaveBeenCalled();
  });
});
