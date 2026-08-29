import { Component, ElementRef, effect, input, viewChild } from '@angular/core';
// 指名 browser 子路徑，不要讓解析條件決定拿到哪個 build。
// 裸的 'jdenticon' 在 node 條件下會給出 jdenticon-node，而它的 update()
// 直接拋 "not supported on Node.js" —— 測試環境就是這樣炸的。
// 這支元件只可能在瀏覽器裡跑（它操作真的 SVG 元素），指名是誠實的。
import * as jdenticon from 'jdenticon/browser';

@Component({
  selector: 'app-jdenticon-avatar',
  standalone: true,
  template: `
    <svg
      #svgIcon
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.data-jdenticon-value]="value()"
    ></svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        border-radius: 50%;
        overflow: hidden;
      }
    `,
  ],
})
export class JdenticonAvatarComponent {
  readonly value = input('Clessia');
  readonly size = input(40);

  // 非 required：view query 解析之前這個 signal 是 undefined，
  // 解析完成時會再觸發下面的 effect —— 所以不需要 afterNextRender 補第一次。
  private readonly svgIcon = viewChild<ElementRef<SVGElement>>('svgIcon');

  constructor() {
    // 改成 signal input 之前，這裡的 effect 沒有讀任何 signal，等於只跑一次；
    // 真正在重繪的是 ngOnChanges。現在 effect 依賴 value 與 view query，
    // 兩者任一改變都會重繪，ngOnChanges 與 afterNextRender 就都不需要了。
    effect(() => {
      const el = this.svgIcon()?.nativeElement;
      const value = this.value();
      if (el) jdenticon.update(el, value);
    });
  }
}
