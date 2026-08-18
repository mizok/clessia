import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';

import { GRADE_LEVEL_LABELS, StudentsService, type Student } from '@core/students.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';

/** 沒有班級的學生不該憑空消失，給一個明確的組 */
const NO_CLASS = '未分班';

interface ClassGroup {
  readonly className: string;
  readonly students: Student[];
}

@Component({
  selector: 'app-students',
  imports: [FormsModule, SelectModule],
  templateUrl: './students.page.html',
  styleUrl: './students.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentsPage {
  readonly page = input.required<RouteObj>();

  private readonly studentsService = inject(StudentsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly GRADE_LABELS = GRADE_LEVEL_LABELS;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly students = signal<Student[]>([]);
  protected readonly search = signal('');
  protected readonly classFilter = signal<string | null>(null);

  /** 依班級分組。一個學生可能同時在兩個班，所以會出現在兩組裡 */
  protected readonly groups = computed<ClassGroup[]>(() => {
    const term = this.search().trim();
    const selected = this.classFilter();
    const byClass = new Map<string, Student[]>();

    for (const student of this.students()) {
      if (term && !student.name.includes(term)) continue;

      const names = student.classNames.length > 0 ? student.classNames : [NO_CLASS];
      for (const className of names) {
        if (selected && className !== selected) continue;
        byClass.set(className, [...(byClass.get(className) ?? []), student]);
      }
    }

    return [...byClass.entries()]
      .map(([className, students]) => ({ className, students }))
      .sort((a, b) => a.className.localeCompare(b.className, 'zh-Hant'));
  });

  protected readonly classOptions = computed(() => [
    { label: '全部班級', value: null as string | null },
    ...Array.from(new Set(this.students().flatMap((s) => s.classNames)))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((name) => ({ label: name, value: name as string | null })),
  ]);

  protected readonly total = computed(() => this.students().length);

  constructor() {
    this.studentsService
      // 範圍由後端依角色強制，這裡帶旗標只是表達意圖
      .list({ taughtByMe: true, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.students.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.students.set([]);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  protected gradeLabel(grade: string): string {
    return this.GRADE_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }
}
