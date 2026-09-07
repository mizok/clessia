import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-sessions-header',
  imports: [],
  templateUrl: './sessions-header.component.html',
  styleUrl: './sessions-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsHeaderComponent {
  readonly monthUnassignedCount = input<number>(0);
  readonly todayPendingAttendanceCount = input<number>(0);
  readonly campusName = input<string | null>(null);
  /**
   * 目前的狀態篩選正在隱藏幾堂已停課（#640）。
   *
   * **0 的時候不渲染。** 沒有數字的話這顆 badge 只能永遠顯示，
   * 而永遠顯示的訊號多數時候在說一件沒有發生的事 —— 那種東西一週內就會被學會忽略。
   * 有數字才做得出條件顯示，所以那支 count 查詢不是為了文案好看。
   */
  readonly hiddenCancelledCount = input<number>(0);
  readonly filterUnassigned = output<void>();
  readonly filterPendingAttendance = output<void>();
  readonly revealCancelled = output<void>();
}
