import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import type { OverlayOptions } from 'primeng/api';

import { GRADE_LEVEL_LABELS, type Student } from '@core/students.service';

@Component({
  selector: 'app-student-autocomplete',
  standalone: true,
  imports: [FormsModule, AutoCompleteModule],
  templateUrl: './student-autocomplete.component.html',
  host: { class: 'block w-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentAutocompleteComponent {
  readonly value = input<Student | string | null>(null);
  readonly suggestions = input<Student[]>([]);
  readonly placeholder = input('輸入姓名模糊搜尋');
  /**
   * 可及名稱（#2468）：placeholder 不是名稱。有 `<label for>` 就給 `inputId` 讓它指到真正的 input；
   * 旁邊是不能用 for 的可見文字就給 `ariaLabelledBy`；都沒有才用 `ariaLabel`
   */
  readonly inputId = input<string | undefined>(undefined);
  readonly ariaLabelledBy = input<string | undefined>(undefined);
  readonly ariaLabel = input<string | undefined>(undefined);
  readonly disabled = input(false);
  readonly forceSelection = input(false);
  /**
   * 多顯示一行「分校 · 家長」（#964）。同名同年級同校的學生只靠「年級 · 學校」分不出來，
   * 而接電話時最可靠的線索是**打來的家長是誰**。預設關：既有使用點一字不動。
   */
  readonly showContact = input(false);
  /** 候選清單掛在哪（預設不變）。放進 dialog／drawer 時傳 'body'，否則清單會被裁掉或蓋住 */
  readonly appendTo = input<string | undefined>(undefined);
  /**
   * 把候選清單排進版面、接在輸入框下方（#2205，使用者 11-03 裁定；不分寬度，計畫席 11-03）：給放在原生
   * `showModal()` 對話框裡的使用處 —— top layer 裡 `appendTo: 'body'` 會被蓋住，浮動又被對話框的捲動外框裁掉。
   * 清單維持掛在自己旁邊（appendTo self），樣式在 styles.css 的 `.student-autocomplete--inline`；
   * 捲動對話框時不自動收起（PrimeNG 預設任何可捲動祖先一捲就收）
   */
  readonly inline = input(false);

  /** inline 時擋掉「捲動就收起」；點外面、Esc、選了一筆照常收 */
  protected readonly inlineOverlay: OverlayOptions = {
    listener: (_event, options) => (options?.type === 'scroll' ? false : options?.valid),
  };

  readonly valueChange = output<Student | string | null>();
  readonly queryChange = output<string>();

  protected onValueChange(value: Student | string | null): void {
    this.valueChange.emit(value);
  }

  protected onComplete(event: AutoCompleteCompleteEvent): void {
    this.queryChange.emit(event.query);
  }

  protected formatStudentContact(student: Student): string {
    return [student.campusNames.join('、'), student.parentNames.join('、')]
      .filter(Boolean)
      .join(' · ');
  }

  protected formatStudentMeta(student: Student): string {
    return `${GRADE_LEVEL_LABELS[student.grade]} · ${student.school?.name ?? '未填寫'}`;
  }
}
