import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonModule } from 'primeng/button';
import { describe, expect, it } from 'vitest';

import { fixPrimeAutoFocus } from './primeng-autofocus-fix';

@Component({
  imports: [ButtonModule],
  template: `
    <p-button id="plain" label="一般" />
    <p-button id="wanted" label="要聚焦" [autofocus]="true" />
  `,
})
class HostComponent {}

describe('fixPrimeAutoFocus（#2004）', () => {
  it('沒指定 autofocus 的 p-button 不帶 autofocus 屬性；明確給 true 的照舊', () => {
    fixPrimeAutoFocus();
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const btn = (id: string) => (f.nativeElement as HTMLElement).querySelector(`#${id} button`)!;
    // 沒修時每一顆都是 autofocus="true"，整頁載入時瀏覽器把焦點給第一顆看得見的
    expect(btn('plain').hasAttribute('autofocus')).toBe(false);
    expect(btn('wanted').getAttribute('autofocus')).toBe('true');
  });
});
