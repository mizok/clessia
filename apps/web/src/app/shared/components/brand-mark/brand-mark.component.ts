import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 品牌 mark：等角立方體的三片面（#2422 的 app icon 去底版；11-12 換立方體版）。
 * 幾何是從 logo master 量出來的（每片面的四個角），所以跟主畫面圖示是同一顆。
 * 圓角用「多邊形往內縮 r、再用 2r 寬的 round-join stroke 補回」做，一個 polygon 就有圓角。
 * 顏色走 CSS 變數，放在哪種底上由父層決定：
 *   --mark-cream（兩片側面，預設奶油）、--mark-orange（底面，預設橘）；
 *   橘色底上兩個都給 zinc-900 就是單色版；淺色底上側面要換深色，奶油會跟底色糊在一起。
 * 尺寸由父層的 class 給（例：`class="h-6"`），svg 自己撐寬。
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0 leading-none' },
  template: `
    <svg
      class="block h-full w-auto"
      viewBox="240 240 772 820"
      stroke-width="44"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polygon
        points="281,439 593,277 585,596 273,757"
        style="fill: var(--mark-cream, #fff3dd); stroke: var(--mark-cream, #fff3dd)"
      />
      <polygon
        points="661,278 971,441 979,756 669,595"
        style="fill: var(--mark-cream, #fff3dd); stroke: var(--mark-cream, #fff3dd)"
      />
      <polygon
        points="622,670 910,842 625,1019 339,840"
        style="fill: var(--mark-orange, #ff6a3d); stroke: var(--mark-orange, #ff6a3d)"
      />
    </svg>
  `,
})
export class BrandMarkComponent {}
