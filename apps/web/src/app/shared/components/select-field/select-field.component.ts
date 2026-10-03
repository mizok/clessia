import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OverlayOptions } from 'primeng/api';
import { Select, type SelectPassThrough } from 'primeng/select';

export interface SelectFieldOption<T> {
  label: string;
  value: T;
}

let seq = 0;

/**
 * A6 的客製下拉（#991 P1，計畫席裁定選項 A：包 p-select＋pt）。
 *
 * 行為沿用 PrimeNG（combobox／listbox、↑↓ Home End、打字跳選、Esc 回觸發鈕），
 * 這裡只換外觀，再補 A6 的兩件事：
 * - **超過 8 項才出搜尋框**；
 * - **≤860px 改成底部面板**（PrimeNG 的 responsive overlay），面板頭寫「在選什麼」＋關閉鈕。
 *
 * 樣式全部走 `pt` 的 Tailwind class，靠 T4 的 layer 順序（utilities 贏 primeng）蓋過 Aura。
 */
@Component({
  selector: 'app-select-field',
  imports: [Select, FormsModule],
  templateUrl: './select-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectFieldComponent<T> {
  readonly label = input.required<string>();
  readonly options = input.required<readonly SelectFieldOption<T>[]>();
  readonly value = model<T | null>(null);
  /**
   * 選單面板掛在哪。預設 body；**放在原生 modal `<dialog>` 裡時要給那個 dialog 元素** ——
   * dialog 在 top layer，掛到 body 的面板會被它蓋住、點不到；給 `'self'` 則會被 dialog 的捲動區裁掉，
   * 也沒有手機的底部面板（#1174 G3 快速選取面板，兩種都實測過）。
   */
  readonly appendTo = input<'body' | HTMLElement>('body');

  protected readonly labelId = `select-field-${++seq}`;
  protected readonly filter = computed(() => this.options().length > 8);
  private readonly select = viewChild.required(Select);

  // A6 的手機斷點是 860px（a6.css），不是專案的 768
  protected readonly overlayOptions: OverlayOptions = {
    responsive: { breakpoint: '860px', direction: 'bottom' },
  };

  protected readonly pt: SelectPassThrough = {
    root: {
      class:
        'h-11 w-full rounded-md border-zinc-300 bg-white shadow-none ' +
        'hover:border-zinc-500 focus-within:border-zinc-900 ' +
        'focus-within:shadow-[0_0_0_3px_rgb(26_22_20/14%)]',
    },
    label: { class: 'px-3.5 text-base font-medium text-zinc-900' },
    dropdown: { class: 'w-10 text-zinc-900' },
    // 型別沒列 overlay，但 Select 有 ptm('overlay')（.p-select-overlay 那層才是看得到的面板）；
    // pcOverlay.root 是外層定位容器，手機版變成全螢幕遮罩。
    ...({
      overlay: {
        class:
          'rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_16px_36px_-14px_rgb(26_22_20/32%)] ' +
          'max-[860px]:w-full max-[860px]:rounded-t-xl max-[860px]:rounded-b-none max-[860px]:border-0 ' +
          'max-[860px]:bg-[#ebe7e4] max-[860px]:px-3 max-[860px]:pb-4 ' +
          // 底部面板頂端的拖曳把手（A6 .ddl::before）
          "max-[860px]:before:mx-auto max-[860px]:before:mt-2 max-[860px]:before:block max-[860px]:before:h-1 max-[860px]:before:w-9 max-[860px]:before:rounded-full max-[860px]:before:bg-zinc-400 max-[860px]:before:content-['']",
      },
    } as SelectPassThrough),
    // 手機版遮罩是 flex 容器，中間那層 <p-motion> 是 inline 寬度 —— 子元素要撐滿才會是全寬底部面板
    pcOverlay: {
      root: { class: 'max-[860px]:*:w-full' },
      content: { class: 'max-[860px]:w-full' },
    },
    header: { class: 'p-0' },
    pcFilter: {
      root: {
        class: 'h-9 rounded-md border-zinc-300 shadow-none focus:border-zinc-900 max-[860px]:h-11',
      },
    },
    listContainer: {
      class: 'max-[860px]:rounded-lg max-[860px]:bg-white max-[860px]:px-1.5 max-[860px]:py-1',
    },
    option: {
      class:
        'min-h-9 gap-2 rounded-sm px-2 text-md text-zinc-900 max-[860px]:min-h-12 max-[860px]:text-base ' +
        'data-[p-focused=true]:bg-zinc-100 data-[p-selected=true]:bg-transparent data-[p-selected=true]:font-semibold',
    },
  };

  protected close(): void {
    this.select().hide(true);
  }
}
