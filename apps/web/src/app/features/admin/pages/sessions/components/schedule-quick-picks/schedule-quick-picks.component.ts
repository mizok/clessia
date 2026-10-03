import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';

/**
 * 「一次勾：」三個控制項（A6 `quick()`，#1174 G3）：這一整天、某位老師這週的課、某個班整期的課。
 * 桌機在工具列下面那一列，手機在快速選取面板裡 —— 同一份。
 */
@Component({
  selector: 'app-schedule-quick-picks',
  imports: [SelectFieldComponent],
  templateUrl: './schedule-quick-picks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleQuickPicksComponent {
  /** 「這一整天」那顆的字（`今天`、`週三 10/7`）；週視圖沒有「這一天」，不給就不出這顆 */
  readonly dayName = input<string | null>(null);
  readonly teacherOptions = input.required<readonly SelectFieldOption<string>[]>();
  readonly classOptions = input.required<readonly SelectFieldOption<string>[]>();
  /** 在 modal dialog 裡（手機面板）要給那個 dialog，見 SelectFieldComponent.appendTo */
  readonly appendTo = input<'body' | HTMLElement>('body');

  readonly pickDay = output<void>();
  readonly pickTeacher = output<string>();
  readonly pickClass = output<string>();
}
