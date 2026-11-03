import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * 全站分頁器（#1314 Z 批，使用者 11-02 裁定換掉 PrimeNG 的 p-paginator）。兩種版型，都照 A6：
 *
 * - `numbered`：A6 `courses.html` —— 置中「‹ 1 2 3 ›」，目前頁黑框。頁數多時加省略號（稿沒畫，延伸）
 * - `compact`（預設）：A6 `grades-student.html`／`meals.html` —— 靠右「第 x／y 頁」＋上一頁／下一頁。
 *   稿沒畫分頁器的列表一律用這個（R5 2026-11-02）
 *
 * 到頭的上一頁／下一頁用 `aria-disabled`，不用 `disabled`：按到最後一頁時焦點正在「下一頁」上，
 * disabled 會把焦點丟回 body，也讓它跳出 Tab 順序。只有一頁時整個不畫（A6：pages > 1 才出）。
 * 外距由呼叫端給（`<app-pager class="mt-6" …>`），各頁的稿不一樣。
 */
@Component({
  selector: 'app-pager',
  templateUrl: './pager.component.html',
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PagerComponent {
  readonly variant = input<'numbered' | 'compact'>('compact');
  /** 總筆數 */
  readonly total = input.required<number>();
  readonly pageSize = input.required<number>();
  /** 目前頁，從 1 起算 */
  readonly page = input.required<number>();
  /** 精簡版的「· 每頁 N 位」：給了單位才寫（A6 grades-student 有、meals 沒有） */
  readonly unit = input<string>();

  /** 新的頁碼（從 1 起算）。點目前頁、或到頭的上一頁／下一頁不發 */
  readonly pageChange = output<number>();

  protected readonly pages = computed(() =>
    Math.max(1, Math.ceil(this.total() / Math.max(1, this.pageSize()))),
  );
  protected readonly slots = computed(() => pageSlots(this.page(), this.pages()));

  protected go(target: number): void {
    if (target < 1 || target > this.pages() || target === this.page()) return;
    this.pageChange.emit(target);
  }
}

/**
 * 數字版要畫的頁碼，`null` 是省略號。7 頁以內全列；超過固定 7 格 ——
 * 頭尾各一格、目前頁左右各一格，靠頭／靠尾時補滿 5 個連號。格數固定，換頁時寬度不跳。
 */
export function pageSlots(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, null, pages];
  if (page >= pages - 3) return [1, null, ...Array.from({ length: 5 }, (_, i) => pages - 4 + i)];
  return [1, null, page - 1, page, page + 1, null, pages];
}
