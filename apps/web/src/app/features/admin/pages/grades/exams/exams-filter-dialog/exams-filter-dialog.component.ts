import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

type ExamTypeFilter = 'academy' | 'school';
type StatusFilter = 'all' | 'todo' | 'active' | 'closed';
type TimeRange = 'all' | '1m' | '3m' | '6m';

interface FilterOption<TValue> {
  label: string;
  value: TValue;
}

export interface ExamsFilterDialogData {
  readonly initial: {
    examType: ExamTypeFilter;
    campusId: string | null;
    schoolId: string | null;
    subjectId: string | null;
    status: StatusFilter;
    timeRange: TimeRange;
  };
  readonly options: {
    campusOptions: ReadonlyArray<FilterOption<string | null>>;
    schoolOptions: ReadonlyArray<FilterOption<string | null>>;
    subjectOptions: ReadonlyArray<FilterOption<string | null>>;
    statusOptions: ReadonlyArray<FilterOption<StatusFilter>>;
    examTypeOptions: ReadonlyArray<FilterOption<ExamTypeFilter>>;
    timeRangeOptions: ReadonlyArray<FilterOption<TimeRange>>;
  };
}

export interface ExamsFilterDialogResult {
  readonly cleared?: boolean;
  readonly examType?: ExamTypeFilter;
  readonly campusId?: string | null;
  readonly schoolId?: string | null;
  readonly subjectId?: string | null;
  readonly status?: StatusFilter;
  readonly timeRange?: TimeRange;
}

@Component({
  selector: 'app-exams-filter-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, SelectButtonModule],
  templateUrl: './exams-filter-dialog.component.html',
  styleUrl: './exams-filter-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExamsFilterDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ExamsFilterDialogData>);

  protected readonly options = this.config.data?.options;

  protected readonly examType = signal<ExamTypeFilter>(this.config.data?.initial.examType ?? 'academy');
  protected readonly campusId = signal<string | null>(this.config.data?.initial.campusId ?? null);
  protected readonly schoolId = signal<string | null>(this.config.data?.initial.schoolId ?? null);
  protected readonly subjectId = signal<string | null>(this.config.data?.initial.subjectId ?? null);
  protected readonly status = signal<StatusFilter>(this.config.data?.initial.status ?? 'all');
  protected readonly timeRange = signal<TimeRange>(this.config.data?.initial.timeRange ?? 'all');

  protected readonly isAcademy = computed(() => this.examType() === 'academy');

  protected apply(): void {
    this.ref.close({
      examType: this.examType(),
      campusId: this.campusId(),
      schoolId: this.schoolId(),
      subjectId: this.subjectId(),
      status: this.status(),
      timeRange: this.timeRange(),
    } satisfies ExamsFilterDialogResult);
  }

  protected clear(): void {
    this.ref.close({ cleared: true } satisfies ExamsFilterDialogResult);
  }
}
