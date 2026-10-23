import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonModule } from 'primeng/button';
import { describe, expect, it } from 'vitest';

@Component({
  imports: [ButtonModule],
  template: `<p-button id="plain" label="一般" />`,
})
class HostComponent {}

/**
 * 哨兵（#2004）：**不套** `fixPrimeAutoFocus`，斷言 PrimeNG 的 bug 還在。
 * 這支變紅＝升級後上游修好了（primefaces/primeng#18774）→ 刪掉 `primeng-autofocus-fix.ts`、`main.ts` 的呼叫和這支。
 * 不要把它改綠來「修」它。這個檔不能 import 補丁：補丁改的是原型，同一個檔裡載入就會蓋掉這裡要量的東西。
 */
describe('PrimeNG autofocus 上游 bug 哨兵（#2004）', () => {
  it('沒指定 autofocus 的 p-button 仍帶 autofocus 屬性（上游還沒修）', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('#plain button')!;
    expect(btn.hasAttribute('autofocus')).toBe(true);
  });
});
