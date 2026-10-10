import { ChangeDetectionStrategy, Component, input } from '@angular/core';

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
}
