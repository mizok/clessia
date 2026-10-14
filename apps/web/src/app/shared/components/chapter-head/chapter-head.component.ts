import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * 章頭（A6 `.chap__side`）：大字章名＋章名下的張數。
 *
 * 桌機是左欄直排（章名 44px、張數在下），手機橫排（章名 26px、張數接在同一行）——
 * 那是 A6 的 `chap` 與 `chap--row` 的合併。**欄位本身（左欄＋右側內容的 grid）不在這裡**：
 * 各頁的右側內容不一樣（課程列、帳單列、表格），grid 由頁面自己擺；這個元件只管「字」。
 *
 * 張數後面要接別的（「待收 NT$ 81,050」）就投影進來。
 */
@Component({
  selector: 'app-chapter-head',
  imports: [],
  templateUrl: './chapter-head.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChapterHeadComponent {
  readonly name = input.required<string>();
  /** 章內的張數／筆數。`null`＝不顯示（例如前端另外再濾過，API 的數字對不上時別編） */
  readonly count = input<number | null>(null);
  /** 張數的單位（「門」「位」「張」） */
  readonly unit = input('');
  /** `error`＝逾期等需要立刻處理的章（A6 `.chap__big--overdue`） */
  readonly tone = input<'default' | 'error'>('default');
  /** 手機也上下堆疊（A6 `chap`，家長頁）；預設手機橫排（`chap--row`，帳單頁） */
  readonly stacked = input(false);

  /**
   * 章名的 class。**整串寫在 TS 裡、用 `[class]` 綁** —— 任意值 class（`text-[34px]`）
   * 不能寫成 `[class.text-[34px]]`：方括號會讓 Angular 的綁定名稱解析失敗，
   * 而且是靜默失效（沒有編譯錯誤、class 就是沒掛上）。
   */
  protected readonly nameClass = computed(
    () =>
      'chapter-head__name m-0 leading-none font-bold tracking-[-0.04em] wide:text-[44px] ' +
      (this.stacked() ? 'text-[34px] ' : 'text-[26px] ') +
      (this.tone() === 'error' ? 'text-error-700' : 'text-zinc-900'),
  );
}
