import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import type { SelectFieldOption } from '@shared/components/select-field/select-field.component';
import type { StartGroup } from '../../schedule-day.util';
import type { BatchMode } from '../session-batch/session-batch.component';
import { ScheduleQuickPicksComponent } from '../schedule-quick-picks/schedule-quick-picks.component';

/**
 * 手機的「快速選取」面板（A6 `#qs`，#1174 G3）：從底部升起，取代原地勾選框與底部批次列。
 * 上面「一次勾：」、中間逐堂勾、底部固定「其他動作」＋橘色主動作（停課）。
 * 關掉面板＝離開選取，已勾的留著（入口按鈕上寫「已勾 N」）。原生 `<dialog>`：Esc、焦點圈住由瀏覽器給。
 */
@Component({
  selector: 'app-schedule-quick-sheet',
  imports: [DatePipe, ScheduleQuickPicksComponent],
  templateUrl: './schedule-quick-sheet.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleQuickSheetComponent {
  readonly open = input(false);
  /** 面板標題旁的字（`今天`、`9/28 – 10/4`、`篩選結果`） */
  readonly title = input.required<string>();
  readonly chapters = input.required<readonly { date: string; groups: StartGroup[] }[]>();
  readonly selectedIds = input.required<ReadonlySet<string>>();
  /** 勾到的課裡，這個面板列得出來的有幾堂 */
  readonly visibleCount = input.required<number>();
  readonly dayName = input<string | null>(null);
  readonly teacherOptions = input.required<readonly SelectFieldOption<string>[]>();
  readonly classOptions = input.required<readonly SelectFieldOption<string>[]>();

  readonly toggle = output<string>();
  readonly pickDay = output<void>();
  readonly pickTeacher = output<string>();
  readonly pickClass = output<string>();
  readonly clear = output<void>();
  /** `null`＝其他動作（開批次對話框，自己選） */
  readonly act = output<BatchMode | null>();
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const d = this.dialog().nativeElement;
      if (this.open() && !d.open) d.showModal();
      if (!this.open() && d.open) d.close();
    });
  }

  /** 點背景＝關閉（面板內容蓋滿整個 dialog，點得到 dialog 本身只會是背景，A6） */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }

  protected statusNote(status: string): string {
    return status === 'cancelled' ? '已停課' : status === 'completed' ? '已上完' : '';
  }
}
