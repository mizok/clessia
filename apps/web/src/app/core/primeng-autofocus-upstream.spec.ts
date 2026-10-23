import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AutoFocus } from 'primeng/autofocus';
import { ButtonModule } from 'primeng/button';
import { describe, expect, it } from 'vitest';

@Component({
  imports: [ButtonModule],
  template: `<p-button id="plain" label="一般" />`,
})
class HostComponent {}

/**
 * 哨兵（#2004）：**不套** `fixPrimeAutoFocus`，斷言 PrimeNG 的 bug 還在。
 * 這支變紅＝升級後上游修好了（primefaces/primeng#18774）→ 刪掉 `primeng-autofocus-fix.ts`、`app.config.ts` 的呼叫和這支。
 * 不要把它改綠來「修」它。
 *
 * `@angular/build:unit-test` 把 spec 打包在一起跑，**檔案之間沒有隔離**：別的檔（`app.config.spec` 匯入
 * `app.config`）可能已經把原型補上了，結果取決於執行順序（#2022 的 CI 就是這樣紅的）。所以這裡量之前
 * 暫時換回補丁留下的原本方法，量完還原，不依賴原型當下的狀態。
 */
describe('PrimeNG autofocus 上游 bug 哨兵（#2004）', () => {
  it('沒指定 autofocus 的 p-button 仍帶 autofocus 屬性（上游還沒修）', () => {
    const proto = AutoFocus.prototype as unknown as {
      onAfterContentChecked: () => void;
      __clessiaOriginal?: () => void;
    };
    const current = proto.onAfterContentChecked;
    proto.onAfterContentChecked = proto.__clessiaOriginal ?? current;
    try {
      const f = TestBed.createComponent(HostComponent);
      f.detectChanges();
      const btn = (f.nativeElement as HTMLElement).querySelector('#plain button')!;
      expect(btn.hasAttribute('autofocus')).toBe(true);
    } finally {
      proto.onAfterContentChecked = current;
    }
  });
});
