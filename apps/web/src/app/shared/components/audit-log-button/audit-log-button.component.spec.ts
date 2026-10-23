import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AuditLogButtonComponent } from './audit-log-button.component';

@Component({
  imports: [AuditLogButtonComponent],
  template: `<app-audit-log-button (click)="opened = opened + 1" />`,
})
class HostComponent {
  opened = 0;
}

describe('AuditLogButtonComponent（#2006）', () => {
  it('時鐘圖示鈕，名稱是「操作紀錄」；點了宿主收到 click', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('操作紀錄');
    expect(btn.getAttribute('title')).toBe('操作紀錄');
    expect(btn.querySelector('.pi-clock')).not.toBeNull();
    btn.click();
    expect(f.componentInstance.opened).toBe(1);
  });
});
