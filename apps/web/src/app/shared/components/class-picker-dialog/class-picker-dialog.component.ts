import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';
import { GRADE_LEVEL_LABELS, GRADE_LEVELS, type GradeLevel } from '@core/students.service';

@Component({
  selector: 'app-class-picker-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    SkeletonModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
  ],
  templateUrl: './class-picker-dialog.component.html',
  styleUrl: './class-picker-dialog.component.scss',
})
export class ClassPickerDialogComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  /**
   * **所有**取數都經過這裡，然後 `switchMap` 出去（#661）。
   *
   * 這個對話框原本就有 `debounceTime(300)` + `distinctUntilChanged`，**所以它看起來是
   * 修好的** —— 而 `debounce` 只解一半：打字間隔超過 300ms 的人仍然會送出多支請求，
   * 回來的順序不保證，**先發的後到就會蓋掉清單**。
   */
  private readonly loadRequests = new Subject<void>();

  protected readonly loading = signal(true);
  protected readonly classes = signal<Class[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  // **刻意不用 LIST_PAGE_SIZE。** 這是對話框裡的挑選器，清單區被 max-height 綁在
  // 340–380px（約 7–8 列），受限的是強制高度不是視窗高度 —— 跟整頁列表是不同的情境。
  protected readonly PAGE_SIZE = 8;
  protected readonly searchQuery = signal('');
  protected readonly gradeFilter = signal<GradeLevel | null>(
    (this.config.data?.studentGrade as GradeLevel) ?? null,
  );

  // 已加入的 classId 集合（從 config.data 傳入），用於過濾
  private readonly existingClassIds = new Set<string>(this.config.data?.existingClassIds ?? []);

  protected readonly gradeOptions = [
    { label: '全部適合年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  protected readonly filteredClasses = computed(() => {
    const grade = this.gradeFilter();
    return this.classes()
      .filter((c) => !this.existingClassIds.has(c.id))
      .filter((c) => !grade || c.gradeLevels?.includes(grade));
  });

  ngOnInit(): void {
    this.setupLoadPipeline();

    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.load();
      });
    this.load();
  }

  /** 觸發取數。實際的請求在 `setupLoadPipeline()` 那條 `switchMap` 管線裡（#661） */
  protected load(): void {
    this.loading.set(true);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.loadRequests
      .pipe(
        switchMap(() =>
          this.classesService
            .list({
              search: this.searchQuery() || undefined,
              isActive: true,
              page: this.currentPage(),
              pageSize: this.PAGE_SIZE,
            })
            // **`catchError` 必須在內層。** 掛外層的話一次 error 就終止整條管線，
            // 這個對話框之後再也載入不了班級 —— 而它連 toast 都沒有，
            // 使用者只會看到一個永遠空著的挑選器。
            .pipe(
              catchError(() => {
                this.loading.set(false);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.classes.set(res.data);
        this.total.set(res.meta.total);
        this.loading.set(false);
      });
  }

  protected onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  protected select(cls: Class): void {
    this.ref.close(cls);
  }

  protected cancel(): void {
    this.ref.close();
  }
}
