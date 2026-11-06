import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { ConfirmDialogComponent, type ConfirmDialogData } from './confirm-dialog.component';

describe('ConfirmDialogComponent（共用殼，#2290）', () => {
  function setup(data: ConfirmDialogData, header: string | undefined = '確認刪除') {
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { header, data } },
      ],
    });
    const fixture = TestBed.createComponent(ConfirmDialogComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, close };
  }

  it('開窗端的 header 是 h2（可及名稱），訊息是副標；✕ 等於取消', () => {
    const { host, close } = setup({ message: '確定要刪除課程「數學」嗎？' });
    expect(host.querySelector('h2')!.textContent).toContain('確認刪除');
    expect(host.querySelector('.dialog-header-inline__sub')!.textContent).toContain('數學');
    host.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('按主鈕回 true；文字照開窗端給的', () => {
    const { host, close } = setup({ message: 'x', acceptLabel: '刪除' });
    const accept = host.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!;
    expect(accept.textContent).toContain('刪除');
    accept.click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('必填原因沒填：主鈕標成停用、按了不關；填了帶原因關', async () => {
    const { fixture, host, close } = setup({ message: 'x', requireNotes: true });
    const accept = host.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!;
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    accept.click();
    expect(close).not.toHaveBeenCalled();

    const area = host.querySelector('textarea')!;
    area.value = ' 家長要求 ';
    area.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    accept.click();
    expect(close).toHaveBeenCalledWith({ notes: '家長要求' });
  });

  it('沒給 header 時寫「確認」，不留空標題', () => {
    const { host } = setup({ message: 'x' }, undefined);
    expect(host.querySelector('h2')!.textContent).toContain('確認');
  });
});
