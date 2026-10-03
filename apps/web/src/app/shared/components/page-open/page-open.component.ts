import { ChangeDetectionStrategy, Component } from '@angular/core';

import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

/**
 * A6 的開場色面（#991 殼切片 S1）：每頁一塊全寬橘面，放「這一頁的那句話」，流場在裡面。
 *
 * **由頁面自己放在模板最上面**，不由殼從 route data 生成 —— 標題常是頁面算出來的
 * （changes 的「10 月 12 則異動」），投影零狀態、零服務。殼看到 main 裡有它就拿掉內距
 * 讓它出血（`shell-layout` 的 `:has(app-page-open)`），頁面本體自己包 `page-wrap`。
 *
 * 流場會動（A6），捲出畫面與 `prefers-reduced-motion` 由 flow-field 自己停。
 * 對比：橘面上只用 `band-ink(-muted)`，那兩個 token 的透明度地板見 styles.scss。
 *
 * 具名插槽：`openBack`（返回連結，學生檔案起）、`openTitle`、`openSub`，其餘內容接在下面。
 * ponytail: A6 的統計列（`stats`）等第一個需要的頁再加。
 */
@Component({
  selector: 'app-page-open',
  imports: [FlowFieldComponent],
  templateUrl: './page-open.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class PageOpenComponent {}
