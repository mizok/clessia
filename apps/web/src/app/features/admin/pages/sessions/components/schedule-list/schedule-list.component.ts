import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Session } from '@core/sessions.service';
import { isLive, type StartGroup } from '../../schedule-day.util';
import type { ScheduleMenuRequest } from '../schedule-gantt/schedule-gantt.component';
import { SessionTagsComponent } from '../session-tags/session-tags.component';

/**
 * 依開始時間分組的課堂清單（A6 `list()`）：手機日視圖、「篩選結果」、週視圖的每一欄共用（#1174 G1／G2）。
 */
@Component({
  selector: 'app-schedule-list',
  imports: [SessionTagsComponent],
  templateUrl: './schedule-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleListComponent {
  readonly groups = input.required<readonly StartGroup[]>();
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly clashIds = input<ReadonlySet<string>>(new Set<string>());
  readonly now = input.required<Date>();
  /** 週視圖的窄欄：只寫結束時間與老師（A6 `list(ss, true)`） */
  readonly compact = input(false);

  readonly toggle = output<string>();
  readonly menu = output<ScheduleMenuRequest>();

  protected live(s: Session): boolean {
    return isLive(s, this.now());
  }
}
