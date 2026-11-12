import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 品牌 mark：三段圓弧排成的 C（#2422 的 app icon 去底版，11-12 換圓弧版）。
 * 幾何是從 logo master 量出來的（圓心、內外半徑、各段角度），所以跟主畫面圖示是同一顆：
 * 三段都是中半徑 400.5 的弧、stroke 寬 233（＝環厚）、butt 端＝徑向切口。
 * 顏色走 CSS 變數，放在哪種底上由父層決定：
 *   --mark-cream（預設奶油）、--mark-orange（預設橘）；橘色底上兩個都給 zinc-900 就是單色版。
 * 尺寸由父層的 class 給（例：`class="h-6"`），svg 自己撐寬。
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0 leading-none' },
  template: `
    <svg
      class="block h-full w-auto"
      viewBox="120 120 912 1040"
      fill="none"
      stroke-width="233"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M337.7 378.2A400.5 400.5 0 0 1 940 375.6"
        style="stroke: var(--mark-cream, #fff3dd)"
      />
      <path
        d="M313.9 873.6A400.5 400.5 0 0 1 311.9 411.3"
        style="stroke: var(--mark-orange, #ff6a3d)"
      />
      <path d="M940 906.4A400.5 400.5 0 0 1 340 906.4" style="stroke: var(--mark-cream, #fff3dd)" />
    </svg>
  `,
})
export class BrandMarkComponent {}
