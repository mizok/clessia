import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { BackdropCloseDirective } from './backdrop-close.directive';

@Component({
  imports: [BackdropCloseDirective],
  template: `
    <dialog (backdropClose)="closed = closed + 1"><button type="button">內容</button></dialog>
  `,
})
class HostComponent {
  closed = 0;
}

describe('BackdropCloseDirective', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { host: fixture.componentInstance, dialog: el.querySelector('dialog')!, el };
  };

  it('點到 dialog 本身（背景）→ 發出', () => {
    const { host, dialog } = setup();
    dialog.click();
    expect(host.closed).toBe(1);
  });

  it('點到內容 → 不發出（正反兩面）', () => {
    const { host, el } = setup();
    el.querySelector('button')!.click();
    expect(host.closed).toBe(0);
  });
});
