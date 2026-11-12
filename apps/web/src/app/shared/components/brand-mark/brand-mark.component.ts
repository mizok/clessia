import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 品牌 mark：三個方塊排成的 C（#2422 的 app icon 去底版）。
 * 幾何是從 icon-512 量出來的（質心／長寬／角度），所以跟主畫面圖示是同一顆。
 * 顏色走 CSS 變數，放在哪種底上由父層決定：
 *   --mark-cream（預設奶油）、--mark-orange（預設橘）；橘色底上兩個都給 zinc-900 就是單色版。
 * 尺寸由父層的 class 給（例：`class="h-6"`），svg 自己撐寬。
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0 leading-none' },
  template: `
    <svg class="block h-full w-auto" viewBox="130 110 260 300" aria-hidden="true" focusable="false">
      <rect
        x="-83.5"
        y="-38"
        width="167"
        height="76"
        rx="18"
        transform="translate(281 172) rotate(5.9)"
        style="fill: var(--mark-cream, #fff3dd)"
      />
      <polygon
        points="157.8,207.7 211.2,221 214.6,292.4 158.7,305.3"
        stroke-width="27"
        stroke-linejoin="round"
        style="fill: var(--mark-orange, #ff6a3d); stroke: var(--mark-orange, #ff6a3d)"
      />
      <rect
        x="-85"
        y="-34.5"
        width="170"
        height="69"
        rx="18"
        transform="translate(277.4 342.4) rotate(-8)"
        style="fill: var(--mark-cream, #fff3dd)"
      />
    </svg>
  `,
})
export class BrandMarkComponent {}
