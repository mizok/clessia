import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { SessionsActionsService } from '../../services/sessions-actions.service';
import { MobileBatchDialogComponent } from './mobile-batch-dialog.component';

/** 共用殼（#2290）：標題「已選 N 堂」；底部列只在選了動作之後才有（@if 投影到 dialogFoot） */
describe('MobileBatchDialogComponent', () => {
  function setup() {
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [MobileBatchDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              sessionIds: ['s1', 's2', 's3'],
              selectedCount: 3,
              teachers: [],
              hasCancelledSelection: false,
              initialMode: null,
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: SessionsActionsService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(MobileBatchDialogComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, close };
  }

  it('標題「已選 3 堂」；還沒選動作時沒有底部列的鈕', () => {
    const { el } = setup();
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('已選 3 堂');
    expect(el.querySelectorAll('.form-dialog__footer button')).toHaveLength(0);
  });

  it('選了動作：底部列有「返回」與「預覽」；返回回到動作清單', () => {
    const { el, fixture } = setup();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('停課'))!.click();
    fixture.detectChanges();

    const foot = () =>
      [...el.querySelectorAll('.form-dialog__footer button')].map((b) => b.textContent?.trim());
    expect(foot()).toEqual(['返回', '預覽']);
    [...el.querySelectorAll<HTMLButtonElement>('.form-dialog__footer button')][0]!.click();
    fixture.detectChanges();
    expect(foot()).toHaveLength(0);
  });

  it('✕ 關窗不帶結果', () => {
    const { el, close } = setup();
    el.querySelector<HTMLButtonElement>('button[aria-label="關閉"]')!.click();
    expect(close).toHaveBeenCalledWith();
  });
});
