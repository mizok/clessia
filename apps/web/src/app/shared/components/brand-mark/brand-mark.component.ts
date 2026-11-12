import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 品牌 mark：等角立方體的三片面（#2422 的 app icon 去底版；11-12 換立方體版）。
 * 幾何是從 logo master 擬合每條邊的直線、取交點當角（不是抓像素極值：圓角會把極值往內拉），
 * 右半以中線鏡射左半、三道縫統一 43（master 是 44／41／42.5，肉眼看得出不等寬），
 * 圓角用「每條邊沿法線內縮 r、再用 2r 寬的 round-join stroke 補回」做（等距內縮，不是往質心縮，縫才會等寬）。
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
        points="283,442 584,257 584,590 283,772"
        style="fill: var(--mark-cream, #fff3dd); stroke: var(--mark-cream, #fff3dd)"
      />
      <polygon
        points="671,257 971,442 971,772 671,590"
        style="fill: var(--mark-cream, #fff3dd); stroke: var(--mark-cream, #fff3dd)"
      />
      <polygon
        points="627,665 922,844 627,1023 332,844"
        style="fill: var(--mark-orange, #ff6a3d); stroke: var(--mark-orange, #ff6a3d)"
      />
    </svg>
  `,
})
export class BrandMarkComponent {}
