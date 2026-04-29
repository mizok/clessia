import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ReactiveFormsModule, ValidationErrors, Validators, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  SchoolExamsService,
  schoolExamTypeLabel,
  type CreateSchoolExamInput,
  type SchoolExamDetail,
  type SchoolExamType,
  type UpdateSchoolExamInput,
} from '@core/school-exams.service';
import { SchoolsService, type School } from '@core/schools.service';

export interface SchoolExamFormDialogData {
  readonly mode: 'create' | 'edit';
  readonly examId?: string;
}

export interface SchoolExamFormDialogResult {
  readonly id: string;
}

const SEMESTER_OPTIONS: Array<{ label: string; value: 1 | 2 }> = [
  { label: '第一學期', value: 1 },
  { label: '第二學期', value: 2 },
];

const SCHOOL_EXAM_TYPES: readonly SchoolExamType[] = [
  'term_exam',
  'mock_exam',
  'other',
];

const EXAM_TYPE_OPTIONS: Array<{ label: string; value: SchoolExamType }> = SCHOOL_EXAM_TYPES.map((value) => ({
  label: schoolExamTypeLabel(value),
  value,
}));

function trimmedRequiredValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim() ? null : { requiredTrimmed: true };
}

@Component({
  selector: 'app-school-exam-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    InputTextModule,
  ],
  templateUrl: './school-exam-form-dialog.component.html',
  styleUrl: './school-exam-form-dialog.component.scss',
})
export class SchoolExamFormDialogComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<SchoolExamFormDialogData>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly semesterOptions = SEMESTER_OPTIONS;
  protected readonly examTypeOptions = EXAM_TYPE_OPTIONS;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly exam = signal<SchoolExamDetail | null>(null);
  protected readonly schools = signal<School[]>([]);
  protected readonly schoolsLoaded = signal(false);

  protected readonly form = this.formBuilder.group({
    academicYear: this.formBuilder.nonNullable.control<number>(this.guessAcademicYear(), {
      validators: [Validators.required, Validators.min(1)],
    }),
    semester: this.formBuilder.nonNullable.control<1 | 2>(2, {
      validators: [Validators.required],
    }),
    examType: this.formBuilder.nonNullable.control<SchoolExamType>('term_exam', {
      validators: [Validators.required],
    }),
    name: this.formBuilder.nonNullable.control<string>('', {
      validators: [Validators.maxLength(100)],
    }),
    schoolId: this.formBuilder.control<string | null>(null, {
      validators: [Validators.required],
    }),
    examDate: this.formBuilder.control<Date | null>(null),
  });

  private readonly formStatus = toSignal(this.form.statusChanges, { initialValue: this.form.status });
  private readonly examTypeValue = toSignal(this.form.controls.examType.valueChanges, {
    initialValue: this.form.controls.examType.value,
  });

  protected readonly mode = computed(() => this.config.data?.mode ?? 'create');
  protected readonly isEditing = computed(() => this.mode() === 'edit');
  protected readonly hasScores = computed(() => (this.exam()?.summary.totalRecordedCount ?? 0) > 0);
  protected readonly isClosed = computed(() => this.exam()?.status === 'closed');
  protected readonly hasNoSchools = computed(
    () => !this.isEditing() && this.schoolsLoaded() && this.schools().length === 0,
  );
  protected readonly isInitialLoading = computed(
    () => this.loading() || (!this.isEditing() && !this.schoolsLoaded()),
  );
  protected readonly isOtherExamType = computed(() => this.examTypeValue() === 'other');
  protected readonly nameLabel = computed(() =>
    this.isOtherExamType() ? '考試名稱 *' : '備註名稱（選填）',
  );
  protected readonly namePlaceholder = computed(() =>
    this.isOtherExamType() ? '請輸入學校考試名稱' : '例如：三月模擬考',
  );

  protected readonly lockYear = computed(() => this.isEditing() || this.hasScores() || this.isClosed());
  protected readonly lockSemester = computed(
    () => this.isEditing() || this.hasScores() || this.isClosed(),
  );
  protected readonly lockExamType = computed(
    () => this.isEditing() || this.hasScores() || this.isClosed(),
  );
  protected readonly lockSchool = computed(() => this.isEditing() || this.hasScores() || this.isClosed());
  protected readonly lockExamDate = computed(() => this.isClosed());
  protected readonly lockName = computed(() => this.isClosed());

  protected readonly canSave = computed(() => {
    this.formStatus();
    if (this.isClosed() || this.saving()) return false;
    return this.form.valid;
  });

  constructor() {
    effect(() => {
      this.setControlDisabled('academicYear', this.lockYear());
      this.setControlDisabled('semester', this.lockSemester());
      this.setControlDisabled('examType', this.lockExamType());
      this.setControlDisabled('schoolId', this.lockSchool());
      this.setControlDisabled('examDate', this.lockExamDate());
      this.setControlDisabled('name', this.lockName());
    });
  }

  ngOnInit(): void {
    this.loadSchools();
    this.applyNameValidator(this.form.controls.examType.value);

    this.form.controls.examType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((examType) => this.applyNameValidator(examType));

    const examId = this.config.data?.examId;
    if (this.isEditing() && examId) {
      this.loading.set(true);
      this.schoolExamsService
        .get(examId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ data }) => {
            this.exam.set(data);
            this.form.patchValue({
              academicYear: data.academicYear,
              semester: data.semester,
              examType: data.examType,
              name: data.name ?? '',
              schoolId: data.schoolId,
              examDate: data.examDate ? new Date(data.examDate) : null,
            });
            this.loading.set(false);
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入學校考試資料',
            });
            this.loading.set(false);
            this.ref.close();
          },
        });
    }
  }

  private loadSchools(): void {
    this.schoolsService
      .list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.schools.set(res.data);
          this.schoolsLoaded.set(true);
        },
        error: () => {
          this.schoolsLoaded.set(true);
          this.messageService.add({
            severity: 'warn',
            summary: '學校清單載入失敗',
            detail: '請稍後重試或聯繫管理員',
          });
        },
      });
  }

  protected goToSchools(): void {
    this.ref.close();
    this.router.navigate(['/admin/schools']);
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.canSave()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const value = this.form.getRawValue();
    const normalizedName = this.normalizeName(value.name);

    if (this.isEditing()) {
      const examId = this.config.data?.examId;
      if (!examId) {
        this.saving.set(false);
        return;
      }

      const input: UpdateSchoolExamInput = {};
      if (!this.lockExamDate()) input.examDate = this.toIsoDate(value.examDate);
      if (!this.lockName()) input.name = normalizedName;

      this.schoolExamsService
        .update(examId, input)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.messageService.add({
              severity: 'success',
              summary: '更新成功',
              detail: `「${res.label}」已更新`,
            });
            this.ref.close({ id: examId } satisfies SchoolExamFormDialogResult);
          },
          error: (err) => {
            this.messageService.add({
              severity: 'error',
              summary: '更新失敗',
              detail: err?.error?.error || '請稍後再試',
            });
            this.saving.set(false);
          },
        });
      return;
    }

    const schoolId = value.schoolId;
    if (!schoolId) {
      this.saving.set(false);
      return;
    }

    const input: CreateSchoolExamInput = {
      academicYear: value.academicYear,
      semester: value.semester,
      examType: value.examType,
      name: normalizedName,
      schoolId,
      examDate: this.toIsoDate(value.examDate),
    };

    this.schoolExamsService
      .create(input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '建立成功',
            detail: `「${res.data.label}」已建立`,
          });
          this.ref.close({ id: res.data.id } satisfies SchoolExamFormDialogResult);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '建立失敗',
            detail: err?.error?.error || '請稍後再試',
          });
          this.saving.set(false);
        },
      });
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected showNameRequiredError(): boolean {
    const control = this.form.controls.name;
    return control.hasError('requiredTrimmed') && (control.touched || this.submitted());
  }

  private applyNameValidator(examType: SchoolExamType): void {
    const validators = [Validators.maxLength(100)];
    if (examType === 'other') validators.unshift(trimmedRequiredValidator);
    this.form.controls.name.setValidators(validators);
    this.form.controls.name.updateValueAndValidity();
  }

  private setControlDisabled(
    controlName: 'academicYear' | 'semester' | 'examType' | 'schoolId' | 'examDate' | 'name',
    disabled: boolean,
  ): void {
    const control = this.form.controls[controlName];
    if (disabled && control.enabled) {
      control.disable({ emitEvent: false });
      return;
    }
    if (!disabled && control.disabled) {
      control.enable({ emitEvent: false });
    }
  }

  private normalizeName(name: string): string | null {
    const trimmed = name.trim();
    return trimmed ? trimmed : null;
  }

  private toIsoDate(date: Date | null): string | null {
    if (!date) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private guessAcademicYear(): number {
    const now = new Date();
    const year = now.getFullYear() - 1911;
    return now.getMonth() + 1 >= 8 ? year : year - 1;
  }
}
