import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

/**
 * 頁面層級行動的**唯一宣告點**。桌機渲染在標頭右上，手機渲染成貼在底部導覽正上方的
 * 停靠列 —— **頁面不需要知道斷點**。
 *
 * ## 為什麼是元件而不是各頁自己加 media query
 *
 * 行政人員 **80% 以上在手機上工作**（2026-09 使用者裁定），而且是抱著小孩、
 * 隨時被打斷的情境。右上角是滑鼠時代的位置，單手持握時最難按到。
 *
 * 直覺的做法是「桌機那顆留著、手機再放一顆」—— 那等於**同一個行動宣告兩次**，
 * 而這輪的全站分析已經有三個實例證明分岔必然發生（點名兩份實作、成績登錄兩份、
 * `selectionMode="range"` 有能力沒用）。所以這裡只收一次宣告，由元件決定渲染在哪。
 *
 * ## 手機的形態：浮起托盤（2026-10，A6 推翻了下面兩段「歷史」）
 *
 * 現行：手機渲染成**浮起托盤**（左右各內縮 12px、圓角、白底、陰影），最多兩顆 ——
 * **次要在左、主要在右**（A6 學生檔案＝「登記請假」＋「收款」；帳單＝「開立帳單」＋「全部提醒」）。
 * 托盤是左右手都碰得到的全寬形態，不是右下角圓鈕，所以舊的反對理由仍然成立；
 * 它推翻的是「貼邊的整條橫線」與「只收一顆」。
 *
 * ### 歷史（2026-10 前的決定，已被 A6 推翻，留著是因為理由仍有參考價值）
 *
 * **「為什麼是全寬停靠列而不是浮動圓鈕」**：圓鈕在右下角，對左手使用者是最遠的角落；
 * 而且圓鈕只放得下圖示，「＋」在不同頁面意思不同，使用者無法從圖示預測按下去會發生什麼。
 * 全寬列左右手都在範圍內，也放得下完整文字。——**托盤保留了這兩點**，只是不再貼邊。
 *
 * **「只收一顆主要行動」**：停靠列放兩顆以上，它就變成第二排導覽。——
 * A6 的反例是**兩顆都是同一個脈絡的動作**（登記請假／收款都是在處理這一個學生），
 * 不是導覽；所以現在放寬到「一顆次要＋一顆主要」，**仍然不收第三顆**（型別上就放不進）。
 *
 * ## 破壞性行動永遠不要放進來
 *
 * 拇指範圍是最容易誤觸的地方。誤觸「新增」只是多一筆草稿，誤觸「刪除」是資料沒了。
 * 刪除／停用／結束一律留在選單裡並且要確認。
 */
export interface PageAction {
  readonly label: string;
  /** primeicons 的 class，例如 `pi pi-plus` */
  readonly icon?: string;
  readonly disabled?: boolean;
}

@Component({
  selector: 'app-page-actions',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './page-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageActionsComponent {
  /** 這一頁的主要行動。不給就只渲染投影的次要行動（桌機），手機上完全不佔空間。 */
  readonly primary = input<PageAction | null>(null);

  /**
   * 托盤左邊那顆（與 `primary` 同一個脈絡的動作，例如「登記請假」＋「收款」）。
   * **沒有 `primary` 時不渲染** —— 托盤的存在理由是主要行動，只剩次要就不該佔一條。
   */
  readonly secondary = input<PageAction | null>(null);
  readonly secondaryClick = output<MouseEvent>();

  /**
   * 桌機標頭要不要也放 `secondary`（預設要）。**手機托盤不受影響**。
   * 頁面的章頭已經有同一個動作時傳 `false`（例如 fee-templates 的「新增期間」），
   * 不然同一個動作在同一屏出現兩次；A6 工具列只放它畫的那幾顆。
   */
  readonly secondaryOnDesktop = input(true);

  /**
   * 帶著原始的 `MouseEvent` —— 有些主要行動要**錨定一個彈出選單**在按鈕上
   * （例如「新增考試」要先選補習班考試還是學校考試），那需要事件的 target。
   *
   * 附帶的好處：手機上事件來自停靠列那顆按鈕，所以選單會錨在畫面下方 ——
   * 正好是拇指旁邊，不用另外處理。
   */
  readonly primaryClick = output<MouseEvent>();

  protected onSecondary(event: MouseEvent): void {
    if (this.secondary()?.disabled) return;
    this.secondaryClick.emit(event);
  }

  protected onPrimary(event: MouseEvent): void {
    if (this.primary()?.disabled) return;
    this.primaryClick.emit(event);
  }
}
