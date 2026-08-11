import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';

import { type GradeLevel } from '@core/students.service';

export interface FilterOption<TValue> {
  readonly label: string;
  readonly value: TValue;
}

export interface ClassViewFilterSnapshot {
  readonly campusId: string;
  readonly search: string;
  readonly selectedGrades: GradeLevel[];
  readonly subjectId: string | null;
}

export interface ClassViewFilterDialogData {
  readonly initial: ClassViewFilterSnapshot;
  readonly options: {
    readonly campusOptions: ReadonlyArray<FilterOption<string>>;
    readonly gradeOptions: ReadonlyArray<FilterOption<GradeLevel>>;
    readonly subjectOptions: ReadonlyArray<FilterOption<string>>;
  };
}

export interface ClassViewFilterDialogResult {
  readonly cleared?: boolean;
  readonly snapshot?: ClassViewFilterSnapshot;
}

@Component({
  selector: 'app-class-view-filter-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, SelectModule, MultiSelectModule],
  templateUrl: './class-view-filter-dialog.component.html',
  styleUrl: './class-view-filter-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassViewFilterDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ClassViewFilterDialogData>);

  protected readonly options = this.config.data?.options;

  protected readonly campusId = signal(this.config.data?.initial.campusId ?? '');
  protected readonly search = signal(this.config.data?.initial.search ?? '');
  protected readonly selectedGrades = signal<GradeLevel[]>(
    this.config.data?.initial.selectedGrades ?? [],
  );
  protected readonly subjectId = signal<string | null>(this.config.data?.initial.subjectId ?? null);

  protected close(): void {
    this.ref.close();
  }

  protected clear(): void {
    this.ref.close({ cleared: true } satisfies ClassViewFilterDialogResult);
  }

  protected apply(): void {
    this.ref.close({
      snapshot: {
        campusId: this.campusId(),
        search: this.search(),
        selectedGrades: this.selectedGrades(),
        subjectId: this.subjectId(),
      },
    } satisfies ClassViewFilterDialogResult);
  }
}
