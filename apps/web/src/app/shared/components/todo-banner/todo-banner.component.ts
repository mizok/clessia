import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * 待辦告警的統一呈現——「一句話 + 可點的入口」。
 *
 * 這是 kb/wiki/architecture/admin-todo-alerts.md 的元件半：管理端五處各自刻了
 * 一份的告警（考試/繳費/課堂/課程）收斂成這一份，只換視覺容器，不動各自的
 * 資料查詢與篩選邏輯——那些邏輯已經是對的（或已經在同一份設計文件裡修對），
 * 呼叫端只需要決定 `count`、投影訊息內容、接住 `action`。
 *
 * `count === 0` 時整條不渲染（沒有待辦就不佔位）。訊息用內容投影而不是字串
 * input，因為每個呼叫端的措辭與強調（`<strong>`）都不一樣，統一格式反而會
 * 逼呼叫端遷就一個格式。
 */
@Component({
  selector: 'app-todo-banner',
  imports: [],
  templateUrl: './todo-banner.component.html',
  styleUrl: './todo-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodoBannerComponent {
  readonly count = input.required<number>();
  /** 目前這個篩選是不是已經套用在頁面上（toggle 樣式的呼叫端才需要） */
  readonly active = input(false);
  readonly icon = input('pi-exclamation-circle');
  readonly action = output<void>();
}
