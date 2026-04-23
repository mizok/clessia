import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  TermExamsService,
  type TermExamDetail,
  type TermExamPeriod,
  type CreateTermExamInput,
  type UpdateTermExamInput,
} from '@core/term-exams.service';
import { SchoolsService, type School } from '@core/schools.service';

export interface TermExamFormDialogData {
  readonly mode: 'create' | 'edit';
  readonly examId?: string;
}

export interface TermExamFormDialogResult {
  readonly id: string;
}

const SEMESTER_OPTIONS: Array<{ label: string; value: 1 | 2 }> = [
  { label: '第一學期', value: 1 },
  { label: '第二學期', value: 2 },
];

const PERIOD_OPTIONS: Array<{ label: string; value: TermExamPeriod }> = [
  { label: '第一次段考', value: 'midterm_1' },
  { label: '期末考（上）', value: 'final_1' },
  { label: '第二次段考', value: 'midterm_2' },
  { label: '期末考（下）', value: 'final_2' },
];

interface FormData {
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  schoolId: string | null;
  examDate: Date | null;
}

@Component({
  selector: 'app-term-exam-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
  ],
  templateUrl: './term-exam-form-dialog.component.html',
  styleUrl: './term-exam-form-dialog.component.scss',
})
export class TermExamFormDialogComponent implements OnInit {
  private readonly termExamsService = inject(TermExamsService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<TermExamFormDialogData>);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly semesterOptions = SEMESTER_OPTIONS;
  protected readonly periodOptions = PERIOD_OPTIONS;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly exam = signal<TermExamDetail | null>(null);
  protected readonly schools = signal<School[]>([]);

  protected readonly formData = signal<FormData>({
    academicYear: this.guessAcademicYear(),
    semester: 2,
    period: 'midterm_1',
    schoolId: null,
    examDate: null,
  });

  protected readonly mode = computed(() => this.config.data?.mode ?? 'create');
  protected readonly isEditing = computed(() => this.mode() === 'edit');
  protected readonly hasScores = computed(
    () => (this.exam()?.summary.totalRecordedCount ?? 0) > 0,
  );
  protected readonly isClosed = computed(() => this.exam()?.status === 'closed');

  protected readonly lockYear = computed(() => this.hasScores() || this.isClosed());
  protected readonly lockSemester = computed(() => this.hasScores() || this.isClosed());
  protected readonly lockPeriod = computed(() => this.hasScores() || this.isClosed());
  protected readonly lockSchool = computed(() => this.hasScores() || this.isClosed());
  protected readonly lockExamDate = computed(() => this.isClosed());

  protected readonly canSave = computed(() => {
    if (this.isClosed()) return false;
    const f = this.formData();
    if (f.academicYear <= 0 || !f.semester || !f.period) return false;
    return !!f.schoolId;
  });

  ngOnInit(): void {
    this.loadSchools();

    const examId = this.config.data?.examId;
    if (this.isEditing() && examId) {
      this.loading.set(true);
      this.termExamsService.get(examId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ data }) => {
            this.exam.set(data);
            this.formData.set({
              academicYear: data.academicYear,
              semester: data.semester,
              period: data.period,
              schoolId: data.schoolId,
              examDate: data.examDate ? new Date(data.examDate) : null,
            });
            this.loading.set(false);
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入段考資料',
            });
            this.loading.set(false);
            this.ref.close();
          },
        });
    }
  }

  private loadSchools(): void {
    this.schoolsService.list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.schools.set(res.data),
        error: () => {
          this.messageService.add({
            severity: 'warn',
            summary: '學校清單載入失敗',
            detail: '請稍後重試或聯繫管理員',
          });
        },
      });
  }

  protected updateField<K extends keyof FormData>(field: K, value: FormData[K]): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    const f = this.formData();

    this.saving.set(true);

    if (this.isEditing()) {
      const input: UpdateTermExamInput = {};
      if (!this.lockYear()) input.academicYear = f.academicYear;
      if (!this.lockSemester()) input.semester = f.semester;
      if (!this.lockPeriod()) input.period = f.period;
      if (!this.lockSchool() && f.schoolId) input.schoolId = f.schoolId;
      if (!this.lockExamDate()) input.examDate = this.toIsoDate(f.examDate);

      const examId = this.config.data?.examId;
      if (!examId) {
        this.saving.set(false);
        return;
      }

      this.termExamsService.update(examId, input)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.messageService.add({
              severity: 'success',
              summary: '更新成功',
              detail: `「${res.label}」已更新`,
            });
            this.ref.close({ id: examId } satisfies TermExamFormDialogResult);
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

    const input: CreateTermExamInput = {
      academicYear: f.academicYear,
      semester: f.semester,
      period: f.period,
      schoolId: f.schoolId!,
      examDate: this.toIsoDate(f.examDate),
    };

    this.termExamsService.create(input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '建立成功',
            detail: `「${res.data.label}」已建立`,
          });
          this.ref.close({ id: res.data.id } satisfies TermExamFormDialogResult);
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
