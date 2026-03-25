import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { ClassesService, type Class } from '@core/classes.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '@core/students.service';
import {
  ENROLLMENT_STATUS_LABELS,
  EnrollmentsService,
  type CopyFromClassInput,
  type Enrollment,
  type EnrollmentStatus,
} from '@core/enrollments.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

interface ClassOption {
  label: string;
  courseId: string;
  courseName: string;
  value: string;
  isEnded: boolean;
  hasStudents: boolean;
  gradeLevels: string[];
}

interface CourseOption {
  label: string;
  value: string; // courseId
}

interface GradeLevelOption {
  label: string;
  value: string; // grade key e.g. 'J1'
}

@Component({
  selector: 'app-copy-roster-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    CheckboxModule,
    TagModule,
    SkeletonModule,
    InlineNoticeComponent,
  ],
  templateUrl: './copy-roster-dialog.component.html',
  styleUrl: './copy-roster-dialog.component.scss',
})
export class CopyRosterDialogComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  private readonly targetClassId: string = this.config.data?.classId ?? '';
  protected readonly campusId: string = this.config.data?.campusId ?? '';
  protected readonly campusName: string = this.config.data?.campusName ?? '';

  protected readonly step = signal<1 | 2 | 3>(1);
  protected readonly classesLoading = signal(true);
  protected readonly enrollmentsLoading = signal(false);
  protected readonly submitting = signal(false);

  /** 同分校的全部班級（已排除自身） */
  private readonly allClassOptions = signal<ClassOption[]>([]);

  /** 課程篩選選項（從 allClassOptions 動態產生） */
  protected readonly courseOptions = computed<CourseOption[]>(() => {
    const seen = new Set<string>();
    const options: CourseOption[] = [{ label: '全部課程', value: '' }];
    for (const cls of this.allClassOptions()) {
      if (cls.courseId && !seen.has(cls.courseId)) {
        seen.add(cls.courseId);
        options.push({ label: cls.courseName || cls.courseId, value: cls.courseId });
      }
    }
    return options;
  });

  /** 目前選中的課程 filter（空字串 = 全部） */
  protected readonly selectedCourseId = signal<string>('');

  /** 目前選中的年級 filter（空字串 = 全部） */
  protected readonly selectedGradeLevel = signal<string>('');

  /** 年級選項（固定清單，加上「全部年級」） */
  protected readonly gradeLevelOptions: GradeLevelOption[] = [
    { label: '全部年級', value: '' },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  /** 依課程 + 年級篩選後的班級清單 */
  protected readonly classOptions = computed<ClassOption[]>(() => {
    const courseId = this.selectedCourseId();
    const grade = this.selectedGradeLevel();
    return this.allClassOptions().filter((cls) => {
      if (courseId && cls.courseId !== courseId) return false;
      if (grade && !cls.gradeLevels.includes(grade)) return false;
      return true;
    });
  });

  protected readonly selectedClassId = signal<string | null>(null);
  protected readonly selectedClassName = signal<string>('');

  protected readonly sourceEnrollments = signal<Enrollment[]>([]);
  protected readonly selectedStatuses = signal<EnrollmentStatus[]>(['active', 'pending_payment']);

  protected readonly filteredCount = computed(() => {
    const statuses = this.selectedStatuses();
    return this.sourceEnrollments().filter((e) => statuses.includes(e.status)).length;
  });

  protected readonly copyResult = signal<{ copied: number; skipped: number } | null>(null);
  protected readonly copyError = signal<string | null>(null);

  protected readonly statusOptions: ReadonlyArray<{ label: string; value: EnrollmentStatus }> = [
    { label: ENROLLMENT_STATUS_LABELS.active, value: 'active' },
    { label: ENROLLMENT_STATUS_LABELS.pending_payment, value: 'pending_payment' },
    { label: ENROLLMENT_STATUS_LABELS.suspended, value: 'suspended' },
    { label: ENROLLMENT_STATUS_LABELS.withdrawal, value: 'withdrawal' },
    { label: ENROLLMENT_STATUS_LABELS.void, value: 'void' },
  ];

  ngOnInit(): void {
    this.loadClasses();
  }

  private loadClasses(): void {
    this.classesLoading.set(true);
    this.copyError.set(null);

    const today = new Date().toISOString().slice(0, 10);
    const params = this.campusId
      ? { pageSize: 200, includeHistorical: true, campusId: this.campusId }
      : { pageSize: 200, includeHistorical: true };

    this.classesService
      .list(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const options: ClassOption[] = res.data
            .filter((cls) => cls.id !== this.targetClassId)
            .map((cls) => ({
              label: cls.name,
              courseId: cls.courseId ?? '',
              courseName: cls.courseName ?? '',
              value: cls.id,
              isEnded: !!cls.endDate && cls.endDate < today,
              hasStudents: (cls.scheduleCount ?? 0) > 0 || !cls.isActive,
              gradeLevels: cls.gradeLevels ?? [],
            }));

          // 為了正確判斷「有學生」，用 enrollmentCount 欄位（若後端有回傳）
          // 目前先以 scheduleCount > 0 作為近似，或讓後端未來補上 enrollmentCount
          this.allClassOptions.set(options);
          this.classesLoading.set(false);
        },
        error: () => {
          this.copyError.set('載入班級失敗，請稍後再試。');
          this.classesLoading.set(false);
        },
      });
  }

  protected onClassSelect(classId: string | null): void {
    if (!classId) return;
    const option = this.allClassOptions().find((item) => item.value === classId);
    this.selectedClassName.set(option?.label ?? '');
    this.fetchSourceEnrollments(classId);
  }

  private fetchSourceEnrollments(classId: string): void {
    this.enrollmentsLoading.set(true);
    this.copyError.set(null);

    this.enrollmentsService
      .list({ classId, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.sourceEnrollments.set(res.data);
          // 回填 hasStudents（以實際 enrollment 數為準）
          this.allClassOptions.update((list) =>
            list.map((cls) =>
              cls.value === classId ? { ...cls, hasStudents: res.data.length > 0 } : cls,
            ),
          );
          this.enrollmentsLoading.set(false);
          this.step.set(2);
        },
        error: () => {
          this.copyError.set('載入來源班級名單失敗，請稍後再試。');
          this.enrollmentsLoading.set(false);
        },
      });
  }

  protected toggleStatus(status: EnrollmentStatus, checked: boolean): void {
    this.selectedStatuses.update((list) => {
      if (checked) return list.includes(status) ? list : [...list, status];
      return list.filter((item) => item !== status);
    });
  }

  protected isStatusChecked(status: EnrollmentStatus): boolean {
    return this.selectedStatuses().includes(status);
  }

  protected submit(): void {
    const sourceClassId = this.selectedClassId();
    if (!sourceClassId || this.selectedStatuses().length === 0) return;

    this.submitting.set(true);
    this.copyError.set(null);

    const input: CopyFromClassInput = {
      targetClassId: this.targetClassId,
      sourceClassId,
      statuses: this.selectedStatuses(),
    };

    this.enrollmentsService
      .copyFromClass(input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.copyResult.set(result);
          this.step.set(3);
        },
        error: (err: { error?: { code?: string } }) => {
          this.submitting.set(false);
          if (err?.error?.code === 'OVER_QUOTA') {
            this.copyError.set('人數已達上限，請縮減篩選的學生狀態後重試。');
            return;
          }
          this.copyError.set('複製失敗，請稍後再試。');
        },
      });
  }

  protected done(): void {
    const result = this.copyResult();
    this.ref.close(result && result.copied > 0 ? 'copied' : undefined);
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected back(): void {
    this.step.set(1);
    this.selectedClassId.set(null);
    this.selectedClassName.set('');
    this.sourceEnrollments.set([]);
    this.selectedStatuses.set(['active', 'pending_payment']);
    this.copyError.set(null);
    this.selectedCourseId.set('');
    this.selectedGradeLevel.set('');
  }
}
