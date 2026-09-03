import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * 狀態的 tone。**形狀與色相是兩個軸**，這個 enum 只是它們的有效組合：
 *
 * | tone       | 形狀（還在等？） | 色相（嚴重度） | 例                    |
 * | ---------- | ---------------- | -------------- | --------------------- |
 * | `done`     | 實心（已定案）   | success        | 已點名、在籍、已結算  |
 * | `pending`  | **中空**（還在等）| 中性           | 還沒上、尚未撰寫      |
 * | `overdue`  | 實心（已積欠）   | warning        | 漏點名、待繳費、缺考  |
 * | `inactive` | 實心（不在等了） | 中性           | 已停用、已退班        |
 *
 * 兩個軸各自獨立這件事在 `overdue` 上最要緊：它跟 `pending` **形狀與色相同時不同**，
 * 所以色盲、灰階列印、爛螢幕都還分得出來。#103 說漏點名是「有問題的中空」——
 * 這裡的處理是讓它**不再是中空**：逾期的未完成從「等待中」變成「積欠中」。
 */
export type StatusTone = 'done' | 'pending' | 'overdue' | 'inactive';

/**
 * **曾經有一個 `failed`（實心 + error 色），從頭到尾零使用者，2026-09-03 刪掉。**
 *
 * 它是「先把詞彙表補齊，之後總會用到」的產物 —— 而共用元件裡沒有人用的分支不是
 * 資產，是**等著被誤用的空位**：下一個人看到它會以為那是既定的語彙，然後把某個
 * 其實該是 `overdue` 的東西畫成 error 紅。
 *
 * 真的需要「已發生的錯誤」時再加回來，**而且要連同第一個使用者一起加**
 * （§三 的兩道關卡：先有使用者，才有詞彙）。
 */

/**
 * 狀態點＋字。**點負責掃視、字負責無障礙** —— 不靠顏色單獨傳達語意（WCAG 1.4.1），
 * 所以標籤文字是必填的內容投影，不是選配。
 */
@Component({
  selector: 'app-status-dot',
  imports: [],
  templateUrl: './status-dot.component.html',
  styleUrl: './status-dot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusDotComponent {
  readonly tone = input.required<StatusTone>();
}
