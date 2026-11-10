import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ClassesService, type Class } from '@core/classes.service';
import { DeactivateClassDialogComponent } from './deactivate-class-dialog.component';

/** 停用開課班照 A6 class.html:249-256（#2361）：一個「停用方式」radio＋單一送出 */
describe('DeactivateClassDialogComponent', () => {
  function setup(cls: Partial<Class>) {
    const close = vi.fn();
    const toggleActive = vi.fn(() => of({}));
    const cancelFutureSessions = vi.fn(() => of({ cancelled: 3 }));
    TestBed.configureTestingModule({
      imports: [DeactivateClassDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              cls: { id: 'k1', name: '數學A班', campusName: '本校', courseName: '數學', ...cls },
            },
          },
        },
        { provide: ClassesService, useValue: { toggleActive, cancelFutureSessions } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(DeactivateClassDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = () => {
      el.querySelector<HTMLButtonElement>('[data-testid="deactivate-submit"]')!.click();
      fixture.detectChanges();
    };
    return { el, fixture, close, toggleActive, cancelFutureSessions, submit };
  }

  it('標題「停用「班名」」、副標「目前 N 位學生在籍」；沒帶人數時副標是麵包屑（不寫 0）', () => {
    const a = setup({ enrolledCount: 12 });
    expect(a.el.querySelector('h2')?.textContent?.trim()).toBe('停用「數學A班」');
    expect(a.el.querySelector('[data-part="dialog-context"]')?.textContent).toContain(
      '目前 12 位學生在籍',
    );

    TestBed.resetTestingModule();
    const b = setup({});
    expect(b.el.querySelector('[data-part="dialog-context"]')?.textContent).toContain(
      '本校 › 數學 › 數學A班',
    );
  });

  it('兩個選項照稿、預設第一個；預設送出＝停用並停課未來課堂', () => {
    const { el, toggleActive, cancelFutureSessions, submit } = setup({ enrolledCount: 3 });
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(radios.map((r) => r.parentElement!.textContent!.trim())).toEqual([
      '停用並停課未來課堂',
      '僅停用班級',
    ]);
    expect(radios[0]!.checked).toBe(true);

    submit();
    expect(toggleActive).toHaveBeenCalledWith('k1');
    expect(cancelFutureSessions).toHaveBeenCalledWith('k1');
  });

  it('選「僅停用班級」：只停用、不停課未來課堂', () => {
    const { el, fixture, toggleActive, cancelFutureSessions, submit } = setup({});
    el.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.click();
    fixture.detectChanges();

    submit();
    expect(toggleActive).toHaveBeenCalledTimes(1);
    expect(cancelFutureSessions).not.toHaveBeenCalled();
  });
});
