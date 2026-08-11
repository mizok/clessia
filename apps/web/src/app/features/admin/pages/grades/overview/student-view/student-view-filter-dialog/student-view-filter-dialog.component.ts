import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { type GradeLevel } from '@core/students.service';

export type StudentActiveStatusFilter = 'all' | 'active' | 'inactive';

export interface FilterOption<TValue> {
  readonly label: string;
  readonly value: TValue;
}

export interface StudentViewFilterSnapshot {
  readonly campusId: string;
  readonly searchText: string;
  readonly grade: GradeLevel | '';
  readonly schoolId: string | null;
  readonly status: StudentActiveStatusFilter;
}

export interface StudentViewFilterDialogData {
  readonly initial: StudentViewFilterSnapshot;
  readonly options: {
    readonly campusOptions: ReadonlyArray<FilterOption<string>>;
    readonly gradeOptions: ReadonlyArray<FilterOption<GradeLevel>>;
    readonly schoolOptions: ReadonlyArray<FilterOption<string>>;
    readonly statusOptions: ReadonlyArray<FilterOption<StudentActiveStatusFilter>>;
  };
  readonly onChange?: (next: StudentViewFilterSnapshot) => void;
  readonly onClear?: () => void;
}

@Component({
  selector: 'app-student-view-filter-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, SelectModule],
  templateUrl: './student-view-filter-dialog.component.html',
  styleUrl: './student-view-filter-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentViewFilterDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<StudentViewFilterDialogData>);

  protected readonly options = this.config.data?.options;

  protected readonly campusId = signal(this.config.data?.initial.campusId ?? '');
  protected readonly searchText = signal(this.config.data?.initial.searchText ?? '');
  protected readonly grade = signal<GradeLevel | ''>(this.config.data?.initial.grade ?? '');
  protected readonly schoolId = signal<string | null>(this.config.data?.initial.schoolId ?? null);
  protected readonly status = signal<StudentActiveStatusFilter>(this.config.data?.initial.status ?? 'active');

  protected close(): void {
    this.ref.close();
  }

  protected clear(): void {
    this.campusId.set('');
    this.searchText.set('');
    this.grade.set('');
    this.schoolId.set(null);
    this.status.set('active');
    this.config.data?.onClear?.();
    this.emitChange();
  }

  protected onCampusChange(value: string | null): void {
    this.campusId.set(value ?? '');
    this.emitChange();
  }

  protected onSearchChange(value: string | null): void {
    this.searchText.set(value ?? '');
    this.emitChange();
  }

  protected onGradeChange(value: GradeLevel | null | ''): void {
    this.grade.set(value ?? '');
    this.emitChange();
  }

  protected onSchoolChange(value: string | null): void {
    this.schoolId.set(value);
    this.emitChange();
  }

  protected onStatusChange(value: StudentActiveStatusFilter | null): void {
    this.status.set(value ?? 'active');
    this.emitChange();
  }

  private emitChange(): void {
    this.config.data?.onChange?.({
      campusId: this.campusId(),
      searchText: this.searchText(),
      grade: this.grade(),
      schoolId: this.schoolId(),
      status: this.status(),
    });
  }
}
