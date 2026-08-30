import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

/**
 * 內部頁的入口面 —— 橘帶。
 *
 * D 說橘是「一整個色面、只出現在入口」，並且預告了「之後的儀表板標頭」。
 * 內部頁的入口面就是標頭：一頁一條橘帶，橫線以下維持白底與既有密度。
 *
 * **流場一律是凍結的，這件事刻意不開放給呼叫端。** D 明令「資料表格後面永遠不放
 * 持續動態」—— 把 `frozen` 做成 input 等於讓下一個人有機會違反它，所以規則寫死在
 * 元件裡而不是寫在文件裡。動畫住在入口，內部頁只留它的殘影。
 *
 * 用法：預設插槽是左側的身分（eyebrow / 標題 / 副標），`[bandAside]` 是右欄
 * （動作在上、錨點數字在下）。兩邊的內容差異很大（列表頁放數字、儀表板放資訊圖），
 * 所以這裡只提供色面與兩欄骨架，內容由頁面自己組。
 */
@Component({
  selector: 'app-page-band',
  imports: [FlowFieldComponent],
  templateUrl: './page-band.component.html',
  styleUrl: './page-band.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageBandComponent {
  /**
   * 流場密度。預設是登入頁（0.8）的三分之一 —— 內部頁的帶是工作畫面的門面，
   * 線太密會變成裝飾在跟內容搶。設 0 等於不要流場。
   */
  readonly fieldDensity = input(0.28);
}
