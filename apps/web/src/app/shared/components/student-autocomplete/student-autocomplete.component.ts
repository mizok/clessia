import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from 'primeng/autocomplete';

import { GRADE_LEVEL_LABELS, type Student } from '@core/students.service';

@Component({
  selector: 'app-student-autocomplete',
  standalone: true,
  imports: [FormsModule, AutoCompleteModule],
  templateUrl: './student-autocomplete.component.html',
  styleUrl: './student-autocomplete.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentAutocompleteComponent {
  readonly value = input<Student | string | null>(null);
  readonly suggestions = input<Student[]>([]);
  readonly placeholder = input('輸入姓名模糊搜尋');
  readonly disabled = input(false);
  readonly forceSelection = input(false);
  /**
   * 多顯示一行「分校 · 家長」（#964）。同名同年級同校的學生只靠「年級 · 學校」分不出來，
   * 而接電話時最可靠的線索是**打來的家長是誰**。預設關：既有使用點一字不動。
   */
  readonly showContact = input(false);

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
