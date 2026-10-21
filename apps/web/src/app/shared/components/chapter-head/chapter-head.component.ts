import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * 章頭（A6 `.chap__side`）：大字章名＋章名下的張數。
 *
 * 桌機是左欄直排（章名 44px、張數 18px 在下）。手機有三種，照各頁的 A6 稿（#1698）：
 * - `stacked`＝A6 `.chap`：一樣上下疊，章名 32px、張數 18px（家長、通知中心）
 * - 預設＝A6 `.chap--row`：橫排，章名 26px、張數 16px 接在同一行（課程、學生、帳單）
 * - `listRow`＝A6 清單頁在 ≤860 覆寫的 `.chap`：橫排，章名 28px、張數 14px（人員、價目表、請假、考試，
 *   各頁稿的 `<style>` 裡）。**開 #1698 時只看了 a6.css 的共用值、以為這四頁是上下疊，conformance 抓到才改**
 *
 * **欄位本身（左欄＋右側內容的 grid）不在這裡**：各頁的右側內容不一樣（課程列、帳單列、表格），grid 由頁面自己擺；這個元件只管「字」
 * 與桌機的黏住（宿主要是 grid 的直屬格子、不能 `self-start`，見 `boxClass`）。
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
  /** 章名下的小字（A6 `.chap__sub`：「10/1（四）」「週二」）。預設空＝不渲染，別頁 DOM 不變 */
  readonly sub = input('');
  /** 章內的張數／筆數。`null`＝不顯示（例如前端另外再濾過，API 的數字對不上時別編） */
  readonly count = input<number | null>(null);
  /** 張數的單位（「門」「位」「張」） */
  readonly unit = input('');
  /** `error`＝逾期等需要立刻處理的章（A6 `.chap__big--overdue`） */
  readonly tone = input<'default' | 'error'>('default');
  /** 手機也上下堆疊（A6 `.chap`）；預設手機橫排（A6 `.chap--row`）。各頁照自己的稿選 */
  readonly stacked = input(false);
  /** A6 清單頁的手機章頭（人員、價目表、請假、考試）：橫排、章名 28px、張數 14px。跟 `stacked` 互斥 */
  readonly listRow = input(false);
  /** 桌機黏住（A6 `.chap__side`）。稿上不是 `.chap` 的頁（家長帳單）關掉，不然是稿沒有的多黏 */
  readonly pinned = input(true);
  /** 桌機章名 32px（A6 grades-class 的章名是課程全名，稿用 inline 從 44 縮成 32） */
  readonly compact = input(false);

  /**
   * 外框：直排（桌機左欄、手機 `stacked`）時子項撐滿那一欄（A6 `.chap__big` 是 block，#1715）；
   * 只有手機橫排（A6 `.chap--row`）是 baseline 對齊、縮成字寬。
   *
   * 桌機黏住（A6 `.chap__side { position: sticky; top: 80px }`，≤860 static）：黏的是這層、不是宿主 ——
   * 宿主是頁面 grid 的格子（預設 stretch，撐滿整章，黏住的範圍就是整章），而各頁在宿主上放的
   * padding 不一樣（pt-8、pt-4）。位置是 `top-sticky-chapter`（tailwind.css 的 token，說明在那裡）。
   */
  protected readonly boxClass = computed(
    () =>
      'chapter-head flex wide:flex-col wide:items-stretch wide:gap-x-0 ' +
      (this.pinned() ? 'wide:sticky wide:top-sticky-chapter ' : '') +
      (this.stacked() ? 'flex-col items-stretch' : 'flex-wrap items-baseline gap-x-3'),
  );

  /**
   * 章名的 class。**整串寫在 TS 裡、用 `[class]` 綁** —— 任意值 class（`text-[34px]`）
   * 不能寫成 `[class.text-[34px]]`：方括號會讓 Angular 的綁定名稱解析失敗，
   * 而且是靜默失效（沒有編譯錯誤、class 就是沒掛上）。
   */
  protected readonly nameClass = computed(
    () =>
      'chapter-head__name m-0 leading-none font-bold tracking-[-0.04em] ' +
      (this.compact() ? 'wide:text-[32px] ' : 'wide:text-[44px] ') +
      (this.stacked() ? 'text-[32px] ' : this.listRow() ? 'text-[28px] ' : 'text-[26px] ') +
      (this.tone() === 'error' ? 'text-error-700' : 'text-zinc-900'),
  );

  /** 張數：A6 `.chap__tally` 是 xl，只有 `.chap--row` 在手機縮成 lg */
  protected readonly tallyClass = computed(
    () =>
      'chapter-head__tally m-0 font-bold tracking-[-0.02em] text-zinc-900 tabular-nums wide:mt-3 wide:text-xl ' +
      (this.stacked() ? 'mt-3 text-xl' : this.listRow() ? 'text-base' : 'text-lg'),
  );
}
