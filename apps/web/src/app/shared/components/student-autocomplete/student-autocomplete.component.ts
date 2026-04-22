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

  readonly valueChange = output<Student | string | null>();
  readonly queryChange = output<string>();

  protected onValueChange(value: Student | string | null): void {
    this.valueChange.emit(value);
  }

  protected onComplete(event: AutoCompleteCompleteEvent): void {
    this.queryChange.emit(event.query);
  }

  protected formatStudentMeta(student: Student): string {
    return `${GRADE_LEVEL_LABELS[student.grade]} · ${student.school?.name ?? '未填寫'}`;
  }
}
