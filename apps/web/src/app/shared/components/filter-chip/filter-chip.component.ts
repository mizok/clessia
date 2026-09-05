import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * 頁面層級的檢視篩選——「只看 X」「顯示 Y」這類縮小畫面內容的開關，
 * 不是在編輯資料。見 kb/wiki/rules/boolean-controls.md 的三分法：
 * checkbox（表格列 / 集合選取）、toggle switch（表單裡單一實體的設定欄位）、
 * 這支（頁面篩選）。
 *
 * tester 抓到的病是「外觀是按鈕，看不出是不是開關」——只換 label 文字、
 * 不換視覺，使用者得讀完整句才知道現在是哪個狀態。這支元件強制視覺跟著
 * `active` 走（同 class-view 的 todo-chip 既有先例），文字可以照舊換（例如
 * 「只看未簽收」/「顯示全部」），但不再是唯一的狀態線索。
 */
@Component({
  selector: 'app-filter-chip',
  imports: [],
  templateUrl: './filter-chip.component.html',
  styleUrl: './filter-chip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterChipComponent {
  readonly active = input(false);
  readonly icon = input<string>();
  readonly toggle = output<void>();
}
