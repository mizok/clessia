import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Session } from '@core/sessions.service';
import { isLive, type StartGroup } from '../../schedule-day.util';
import {
  pickEvent,
  type ScheduleMenuRequest,
  type SchedulePickRequest,
} from '../schedule-gantt/schedule-gantt.component';
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

  readonly toggle = output<SchedulePickRequest>();
  readonly menu = output<ScheduleMenuRequest>();
  /** 手機長按一堂（A6）：頁面勾起它並打開快速選取面板 */
  readonly longPress = output<string>();

  protected onPickClick(event: MouseEvent, id: string): void {
    const req = pickEvent(event, id);
    if (req) this.toggle.emit(req);
  }
  /** 長按已觸發：接下來那一下 click 不再開選單 */
  protected pressed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected pressStart(event: PointerEvent, id: string): void {
    this.pressed = false;
    // 滑鼠沒有長按這回事；捲動時瀏覽器會發 pointercancel，計時就取消
    if (event.pointerType === 'mouse') return;
    this.timer = setTimeout(() => {
      this.pressed = true;
      this.longPress.emit(id);
    }, 500);
  }

  protected pressEnd(): void {
    clearTimeout(this.timer);
  }

  protected onMain(event: Event, s: Session): void {
    if (this.pressed) {
      this.pressed = false;
      return;
    }
    this.menu.emit({ event, session: s });
  }

  protected live(s: Session): boolean {
    return isLive(s, this.now());
  }
}
