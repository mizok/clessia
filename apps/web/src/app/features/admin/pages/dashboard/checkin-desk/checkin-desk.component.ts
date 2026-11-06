import { Component, computed, input, output, signal } from '@angular/core';

import type { WorkbenchExpectedStudent } from '@core/workbench.service';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';

/**
 * 櫃台代刷到班（#2314，A6 `a6.js` `forms.checkin`）：幫沒帶卡的學生依姓名登記到班，課前也能用。
 *
 * 只負責選人；寫入、更新看板、關窗都在儀表板（跟看板列的「代刷到班」走同一支 `checkIn`）。
 * 候選＝今天在這分校要來、還沒到、沒請假的人（稿「學生（今天還沒到的）」），由儀表板從 workbench 算好給。
 * 稿的「到班時間」欄不畫：`POST /api/daily-checkins` 用伺服器時間記到班，沒有可寫的欄位（R5）。
 */
@Component({
  selector: 'app-checkin-desk',
  imports: [DialogFrameComponent, SelectFieldComponent],
  templateUrl: './checkin-desk.component.html',
  host: { class: 'block' },
})
export class CheckinDeskComponent {
  readonly candidates = input.required<readonly WorkbenchExpectedStudent[]>();
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  /** 下拉面板掛在外層原生 `<dialog>` 上，不然會被 top layer 蓋住（select-field 的說明） */
  readonly overlayHost = input<HTMLElement | 'body'>('body');

  readonly submitted = output<WorkbenchExpectedStudent>();
  readonly closed = output<void>();

  protected readonly picked = signal<string | null>(null);

  protected readonly options = computed<SelectFieldOption<string>[]>(() =>
    this.candidates().map((s) => ({
      label: s.grade ? `${s.studentName}（${s.grade}）` : s.studentName,
      value: s.studentId,
    })),
  );

  /** A6 `.fdlg__why`：還差什麼；空字串＝可以送 */
  protected readonly missingHint = computed(() =>
    this.picked() === null ? '還沒填：學生（今天還沒到的）' : '',
  );

  protected submit(): void {
    const student = this.candidates().find((s) => s.studentId === this.picked());
    if (student && !this.busy()) this.submitted.emit(student);
  }
}
