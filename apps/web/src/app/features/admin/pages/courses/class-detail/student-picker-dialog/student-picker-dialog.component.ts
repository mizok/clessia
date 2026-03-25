import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  StudentsService,
  Student,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import { EnrollmentsService, BatchCreateResultItem } from '@core/enrollments.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

@Component({
  selector: 'app-student-picker-dialog',
  standalone: true,
  imports: [
    FormsModule, ButtonModule, InputTextModule, SelectModule,
    TagModule, SkeletonModule, IconFieldModule, InputIconModule,
    InlineNoticeComponent,
  ],
  templateUrl: './student-picker-dialog.component.html',
  styleUrl: './student-picker-dialog.component.scss',
})
export class StudentPickerDialogComponent implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  protected readonly loading = signal(true);
  protected readonly confirming = signal(false);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly students = signal<Student[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = 20;

  protected readonly searchQuery = signal('');
  protected selectedGrade: GradeLevel | null = null;
  protected selectedGender: string | null = null;

  // 兩步 wizard 狀態
  protected readonly step = signal<'selecting' | 'reviewing'>('selecting');

  // 多選狀態：選中的 studentId set
  protected readonly selectedIds = signal<Set<string>>(new Set());

  // 從 class-detail 傳入的 config
  private readonly existingStudentIds = new Set<string>(this.config.data?.existingStudentIds ?? []);
  private readonly maxStudents: number = this.config.data?.maxStudents ?? 9999;
  private readonly currentActiveCount: number = this.config.data?.currentActiveCount ?? 0;
  private readonly classId: string = this.config.data?.classId ?? '';
  protected readonly remainingSlots = this.maxStudents - this.currentActiveCount;

  protected readonly gradeOptions = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];
  protected readonly gradeLabelMap = GRADE_LEVEL_LABELS;
  protected readonly genderOptions = [
    { label: '全部性別', value: null },
    { label: '男', value: 'male' },
    { label: '女', value: 'female' },
    { label: '不提供', value: 'prefer_not_to_say' },
  ];
  // 過濾掉已在班的學生
  protected readonly filteredStudents = computed(() =>
    this.students().filter((s) => !this.existingStudentIds.has(s.id)),
  );

  // 選中的人數
  protected readonly selectedCount = computed(() => this.selectedIds().size);

  // 選中的 Student 物件清單（Step 2 預覽用）
  protected readonly selectedStudents = computed(() =>
    this.students().filter((s) => this.selectedIds().has(s.id)),
  );

  // 超額檢查（Step 2 用）
  protected readonly overQuotaCount = computed(() =>
    Math.max(0, this.selectedCount() - this.remainingSlots),
  );

  ngOnInit(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.load();
      });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.studentsService
      .list({
        search: this.searchQuery() || undefined,
        grade: this.selectedGrade ?? undefined,
        isActive: true,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.students.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  protected onFilterChange(): void {
    this.currentPage.set(1);
    this.load();
  }

  protected toggleSelection(student: Student): void {
    const ids = new Set(this.selectedIds());
    if (ids.has(student.id)) {
      ids.delete(student.id);
    } else {
      ids.add(student.id);
    }
    this.selectedIds.set(ids);
  }

  protected isSelected(studentId: string): boolean {
    return this.selectedIds().has(studentId);
  }

  protected goToReview(): void {
    this.step.set('reviewing');
  }

  protected goBack(): void {
    this.step.set('selecting');
  }

  protected removeFromReview(studentId: string): void {
    const ids = new Set(this.selectedIds());
    ids.delete(studentId);
    this.selectedIds.set(ids);
    if (ids.size === 0) this.step.set('selecting');
  }

  // 確認加入：dialog 自行呼叫 API，顯示 loading，完成後關閉並傳回結果
  protected confirm(): void {
    this.confirming.set(true);
    this.confirmError.set(null);
    this.enrollmentsService
      .batchCreate({ classId: this.classId, studentIds: Array.from(this.selectedIds()) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.confirming.set(false);
          this.ref.close(res); // 傳 { results: BatchCreateResultItem[] } 給 parent
        },
        error: (err) => {
          this.confirming.set(false);
          const code = err?.error?.code ?? err?.error?.error;
          this.confirmError.set(
            code === 'OVER_QUOTA' || code === 'over_quota'
              ? '超過班級人數上限，請減少加入人數'
              : '加入失敗，請稍後再試',
          );
        },
      });
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected getStudentHue(studentId: string): number {
    let hash = 0;
    for (let i = 0; i < studentId.length; i++) {
      hash = (hash * 31 + studentId.charCodeAt(i)) & 0xfffffff;
    }
    const raw = hash % 320;
    return raw < 45 ? raw + 160 : raw;
  }
}
