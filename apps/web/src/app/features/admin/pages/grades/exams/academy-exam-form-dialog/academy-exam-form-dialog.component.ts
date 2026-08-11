import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { forkJoin } from 'rxjs';

import {
  AcademyExamsService,
  type AcademyExamDetail,
  type AcademyExamType,
  type CreateAcademyExamInput,
  type UpdateAcademyExamInput,
} from '@core/academy-exams.service';
import { ClassesService, type Class } from '@core/classes.service';
import { ReferenceDataService } from '@core/reference-data.service';

export interface AcademyExamFormDialogData {
  readonly mode: 'create' | 'edit';
  readonly examId?: string;
}

export interface AcademyExamFormDialogResult {
  readonly id: string;
}

const ACADEMY_EXAM_TYPE_OPTIONS: Array<{ label: string; value: AcademyExamType }> = [
  { label: '小考', value: 'quiz' },
  { label: '模擬考', value: 'mock_exam' },
  { label: '分班考', value: 'placement_test' },
];

interface FormData {
  name: string;
  examType: AcademyExamType;
  subjectId: string | null;
  campusId: string | null;
  examDate: Date | null;
  totalScore: number;
  scopeNote: string;
  classIds: string[];
}

@Component({
  selector: 'app-academy-exam-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    MultiSelectModule,
    TextareaModule,
    DatePickerModule,
  ],
  templateUrl: './academy-exam-form-dialog.component.html',
  styleUrl: './academy-exam-form-dialog.component.scss',
})
export class AcademyExamFormDialogComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly classesService = inject(ClassesService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<AcademyExamFormDialogData>);

  protected readonly examTypeOptions = ACADEMY_EXAM_TYPE_OPTIONS;

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly exam = signal<AcademyExamDetail | null>(null);
  protected readonly classes = signal<Class[]>([]);

  protected readonly subjects = computed(() => this.refData.subjects());
  protected readonly campuses = computed(() => this.refData.campuses());

  protected readonly subjectOptions = computed(() =>
    this.subjects().map((s) => ({ label: s.name, value: s.id })),
  );
  protected readonly campusOptions = computed(() => [
    { label: '全體校區', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);
  protected readonly classOptions = computed(() => {
    const campusFilter = this.formData().campusId;
    const subjectFilter = this.formData().subjectId;
    const rows = this.classes().filter(
      (c) =>
        c.isActive &&
        (!campusFilter || c.campusId === campusFilter) &&
        (!subjectFilter || c.subjectId === subjectFilter),
    );
    return rows.map((c) => ({
      label: `${c.campusName ?? ''} ${c.courseName ?? ''} / ${c.name}`.trim(),
      value: c.id,
    }));
  });

  protected readonly formData = signal<FormData>({
    name: '',
    examType: 'quiz',
    subjectId: null,
    campusId: null,
    examDate: null,
    totalScore: 100,
    scopeNote: '',
    classIds: [],
  });

  protected readonly mode = computed(() => this.config.data?.mode ?? 'create');
  protected readonly isEditing = computed(() => this.mode() === 'edit');
  protected readonly hasScores = computed(() => (this.exam()?.summary.recordedCount ?? 0) > 0);
  protected readonly isClosed = computed(() => this.exam()?.status === 'closed');

  // Metadata lock rules
  protected readonly lockExamType = computed(() => this.isEditing());
  protected readonly lockSubject = computed(() => this.isEditing());
  protected readonly lockTotalScore = computed(() => this.isEditing());
  protected readonly lockCampus = computed(() => this.isEditing());
  protected readonly lockClasses = computed(() => this.hasScores() || this.isClosed());
  protected readonly lockName = computed(() => this.isClosed());
  protected readonly lockExamDate = computed(() => this.isClosed());
  protected readonly lockScopeNote = computed(() => this.isClosed());

  protected readonly canSave = computed(() => {
    if (this.isClosed()) return false;
    const f = this.formData();
    return (
      f.name.trim().length > 0 &&
      !!f.subjectId &&
      !!f.examDate &&
      f.totalScore > 0 &&
      f.classIds.length > 0
    );
  });

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.refData.loadSubjects();
    this.loadInitialData();
  }

  private loadInitialData(): void {
    this.loading.set(true);
    const examId = this.config.data?.examId;
    const classes$ = this.classesService.list({ isActive: true, pageSize: 0 });

    if (this.isEditing() && examId) {
      forkJoin({
        detail: this.academyExamsService.get(examId),
        classes: classes$,
      })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ detail, classes }) => {
            this.classes.set(classes.data);
            this.exam.set(detail.data);
            const d = detail.data;
            this.formData.set({
              name: d.name,
              examType: d.examType,
              subjectId: d.subjectId,
              campusId: d.campusId,
              examDate: d.examDate ? new Date(d.examDate) : null,
              totalScore: d.totalScore,
              scopeNote: d.scopeNote ?? '',
              classIds: d.classes.map((c) => c.classId),
            });
            this.loading.set(false);
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '載入失敗',
              detail: '無法載入考試資料',
            });
            this.loading.set(false);
            this.ref.close();
          },
        });
      return;
    }

    classes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.classes.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入班級清單',
        });
        this.loading.set(false);
      },
    });
  }

  protected updateField<K extends keyof FormData>(field: K, value: FormData[K]): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected onCampusChange(value: string | null): void {
    this.formData.update((f) => ({
      ...f,
      campusId: value,
      // 清掉不屬於該校區的 class
      classIds: f.classIds.filter((id) => {
        const cls = this.classes().find((c) => c.id === id);
        return !value || cls?.campusId === value;
      }),
    }));
  }

  protected onSubjectChange(value: string | null): void {
    this.formData.update((f) => ({
      ...f,
      subjectId: value,
      classIds: f.classIds.filter((id) => {
        const cls = this.classes().find((c) => c.id === id);
        return !value || cls?.subjectId === value;
      }),
    }));
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) return;
    const f = this.formData();
    const examDate = this.toIsoDate(f.examDate);
    if (!examDate) return;

    this.saving.set(true);

    if (this.isEditing()) {
      const input: UpdateAcademyExamInput = {};
      if (!this.lockName()) input.name = f.name.trim();
      if (!this.lockExamType()) input.examType = f.examType;
      if (!this.lockSubject()) input.subjectId = f.subjectId;
      if (!this.lockExamDate()) input.examDate = examDate;
      if (!this.lockTotalScore()) input.totalScore = f.totalScore;
      if (!this.lockScopeNote()) input.scopeNote = f.scopeNote.trim() || null;
      if (!this.lockClasses()) input.classIds = f.classIds;
      if (!this.lockCampus()) input.campusId = f.campusId;

      const examId = this.config.data?.examId;
      if (!examId) {
        this.saving.set(false);
        return;
      }

      this.academyExamsService
        .update(examId, input)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: '更新成功',
              detail: `「${f.name}」已更新`,
            });
            this.ref.close({ id: examId } satisfies AcademyExamFormDialogResult);
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

    const input: CreateAcademyExamInput = {
      name: f.name.trim(),
      examType: f.examType,
      subjectId: f.subjectId,
      campusId: f.campusId,
      examDate,
      totalScore: f.totalScore,
      scopeNote: f.scopeNote.trim() || null,
      classIds: f.classIds,
    };

    this.academyExamsService
      .create(input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '建立成功',
            detail: `「${f.name}」已建立`,
          });
          this.ref.close({ id: res.data.id } satisfies AcademyExamFormDialogResult);
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
}
