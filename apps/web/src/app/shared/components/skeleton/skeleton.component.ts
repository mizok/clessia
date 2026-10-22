import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** 名字那條的長度輪替（em）：一樣長的細條讀起來像進度條，不像一列列的名字 */
const NAME_WIDTHS = ['4.5em', '3.5em', '5.5em', '4em', '6em'];
const SUB_WIDTHS = ['11em', '8em', '13em', '9em', '10em'];

/**
 * 載入骨架：**長得跟內容一樣**（#1879，使用者 10-22「這些 skeleton 長度不能跟內容一樣長嗎？」）。
 *
 * ```html
 * <app-skeleton label="學生載入中" shape="cards" chapter [count]="8" />
 * ```
 *
 * - **不帶任何內距**：骨架跟內容佔同一條左緣、右緣（舊的全域 `.skeleton-list` 帶 24px 左右內距，骨架左右各縮一截；現在 `.skeleton-list` 只是這個元件的 BEM block 名，沒有樣式）。
 *   上下的間距由呼叫端照內容的間距給。
 * - 細條包在跟內容同字級的行裡（`h-[1em]` 放在 `text-lg` 的行內），所以每一列的高度就是內容那一列的高度，
 *   資料到的那一下不會長高或縮短。
 * - 形狀：
 *   - `rows`：一列一列的清單（左邊名字＋副行、右邊數字）。`[lines]="1"` 是單行列（帳單、請假）；
 *     `heading` 在上面加段標
 *   - `cards`：桌機是一格一格的短名字（學生頁的名字格，`auto-fill minmax(150px)`），手機退回列
 *   - `chapter`：外面再包一層章節（A6 `.chap`：桌機左欄大字章名＋張數、手機章名在上），
 *     給有 `app-chapter-head` 的頁
 */
@Component({
  selector: 'app-skeleton',
  imports: [NgTemplateOutlet],
  templateUrl: './skeleton.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class SkeletonComponent {
  /** 給報讀器的「XX 載入中」 */
  readonly label = input.required<string>();
  readonly shape = input<'rows' | 'cards'>('rows');
  /** 列數（`cards` 是格數） */
  readonly count = input(3);
  /** 1＝單行列；2＝名字＋副行 */
  readonly lines = input<1 | 2>(2);
  /** `rows` 上面先放段標（粗體段名＋黑線） */
  readonly heading = input(false, { transform: (v: boolean | '') => v !== false });
  /** 外面包一層章節（左欄章名） */
  readonly chapter = input(false, { transform: (v: boolean | '') => v !== false });
  /** 章節數（`chapter` 時）；`count` 是每章的列數 */
  readonly chapters = input(1);

  protected readonly chapterList = computed(() => Array.from({ length: this.chapters() }));

  protected readonly items = computed(() =>
    Array.from({ length: this.count() }, (_, i) => ({
      name: NAME_WIDTHS[i % NAME_WIDTHS.length],
      sub: SUB_WIDTHS[i % SUB_WIDTHS.length],
    })),
  );
}
