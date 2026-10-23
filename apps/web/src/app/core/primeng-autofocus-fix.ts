import { AutoFocus } from 'primeng/autofocus';

/**
 * PrimeNG 的 bug（#2004）：`p-button` 的模板是 `[pAutoFocus]="autofocus || buttonProps?.autofocus"`，
 * 兩個都沒給時是 `undefined`；`AutoFocus` 只在 `=== false` 時拿掉屬性，其餘一律 `setAttribute('autofocus', true)`。
 * 結果**全站每一顆 `p-button` 都帶 `autofocus`**，整頁載入時瀏覽器原生把焦點給第一顆看得見的按鈕
 * （學生頁手機：第一列的「⋯」被畫上焦點框，使用者 iPhone 截圖）。原生聚焦，所以 `.focus()` 攔不到。
 *
 * - **版本**：repo 用 primeng 21.1.1；2026-10-23 下載 21.1.10 看過，`AutoFocus` 與 `p-button` 的寫法沒變，還在。
 * - **上游**：https://github.com/primefaces/primeng/issues/18774（AutoFocus 在 undefined 時設屬性）、
 *   https://github.com/primefaces/primeng/issues/18795（第一次載入時按鈕自動聚焦），10-23 都還 open。
 *   同一個根源也影響 datepicker（https://github.com/primefaces/primeng/issues/19010），這個補丁一併蓋到。
 * - **移除條件**：升級 PrimeNG 後，`primeng-autofocus-upstream.spec.ts`（不套補丁、斷言 bug 還在）變紅，
 *   代表上游修好了 → 刪掉這個檔、`main.ts` 的呼叫和那支哨兵 spec。
 *
 * 修在這一個入口：沒指定（不是 `true`）一律當成 `false`。明確寫了 `autofocus` 的照舊。
 * ponytail: 補丁 PrimeNG 的原型；移除條件見上。
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
