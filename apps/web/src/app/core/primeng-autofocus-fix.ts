import { AutoFocus } from 'primeng/autofocus';

/**
 * PrimeNG 21.1.x 的 bug（#2004，21.1.10 還在）：`p-button` 的模板是 `[pAutoFocus]="autofocus || buttonProps?.autofocus"`，
 * 兩個都沒給時是 `undefined`；`AutoFocus` 只在 `=== false` 時拿掉屬性，其餘一律 `setAttribute('autofocus', true)`。
 * 結果**全站每一顆 `p-button` 都帶 `autofocus`**，整頁載入時瀏覽器原生把焦點給第一顆看得見的按鈕
 * （學生頁手機：第一列的「⋯」被畫上焦點框，使用者 iPhone 截圖）。原生聚焦，所以 `.focus()` 攔不到。
 *
 * 修在這一個入口：沒指定（不是 `true`）一律當成 `false`。明確寫了 `autofocus` 的照舊。
 * ponytail: 補丁 PrimeNG 的原型；它修好（`!== true` 才移除）之後刪掉這個檔與 main.ts 的呼叫。
 */
export function fixPrimeAutoFocus(): void {
  const proto = AutoFocus.prototype as unknown as {
    autofocus: unknown;
    onAfterContentChecked: () => void;
    __clessiaFixed?: boolean;
  };
  if (proto.__clessiaFixed) return;
  const original = proto.onAfterContentChecked;
  proto.onAfterContentChecked = function (this: typeof proto) {
    if (this.autofocus !== true) this.autofocus = false;
    original.call(this);
  };
  proto.__clessiaFixed = true;
}
