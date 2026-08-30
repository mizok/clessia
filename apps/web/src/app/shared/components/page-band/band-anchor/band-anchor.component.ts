import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * 橘帶上的錨點數字。
 *
 * 入口頁的視覺錨點是 40px 的字標；內部頁沒有字標，但每一頁都有一個真正重要的數字。
 * 用同一套做法放大它（緊字距），它就是這一頁的字標。
 *
 * **放最可行動的那個數字，不一定是總數** —— 課程管理放「需介入 7」而不是「42 個課程」。
 * 總數不會讓任何人做任何事。
 */
@Component({
  selector: 'app-band-anchor',
  imports: [],
  templateUrl: './band-anchor.component.html',
  styleUrl: './band-anchor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BandAnchorComponent {
  /** 放大的那個數字 */
  readonly value = input.required<string | number>();
  /** 跟在數字後面的單位（「名學生」、「/ 24 人」） */
  readonly unit = input('');
}
