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
 * ## 為什麼是全寬停靠列而不是浮動圓鈕
 *
 * 圓鈕在右下角，**對左手使用者是最遠的角落**；而且圓鈕只放得下圖示，
 * 而「＋」在不同頁面意思不同（新增課程／新增人員／新增請假）——
 * 使用者無法從圖示預測按下去會發生什麼。全寬列左右手都在範圍內，也放得下完整文字。
 *
 * ## 只收一顆主要行動
 *
 * `primary` 是單數，**這是刻意的**。次要行動（操作紀錄、匯入）走投影內容、只在桌機標頭出現。
 * 停靠列放兩顆以上，它就變成第二排導覽，而導覽已經有 `bottom-bar` 了。
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
  styleUrl: './page-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageActionsComponent {
  /** 這一頁的主要行動。不給就只渲染次要行動（桌機），手機上完全不佔空間。 */
  readonly primary = input<PageAction | null>(null);

  readonly primaryClick = output<void>();

  protected onPrimary(): void {
    if (this.primary()?.disabled) return;
    this.primaryClick.emit();
  }
}
