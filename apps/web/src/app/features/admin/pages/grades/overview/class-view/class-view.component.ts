import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { CampusContextService } from '@core/campus-context.service';

import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DialogService } from 'primeng/dynamicdialog';
import { PopoverModule } from 'primeng/popover';
import { FitPopoverDirective } from '@shared/directives/fit-popover.directive';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { RouterLink } from '@angular/router';
import { type Class, ClassesService } from '@core/classes.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { AcademyExamsService } from '@core/academy-exams.service';
import { GRADE_LEVEL_LABELS, GRADE_LEVELS, type GradeLevel } from '@core/students.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { catchError, filter, map, of } from 'rxjs';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';

import { ClassScoresDialogComponent } from './class-scores-dialog/class-scores-dialog.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

interface ClassItem {
  readonly classInfo: Class;
  readonly gradeLabels: string;
  readonly gradeLevels: GradeLevel[];
}

/** 這班的待登錄：場數＋最早要登的那一場（徽章連過去的登錄頁） */
interface TodoInfo {
  readonly count: number;
  readonly examId: string | null;
}

interface CourseGroup {
  readonly courseId: string;
  readonly courseName: string;
  readonly subjectId: string | null;
  readonly subjectName: string;
  readonly gradeRange: string;
  readonly classes: ClassItem[];
}

@Component({
  selector: 'app-class-view',
  standalone: true,
  imports: [
    TextSwapDirective,
    SkeletonComponent,
    FormsModule,
    MultiSelectModule,
    SelectModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    PopoverModule,
    FitPopoverDirective,
    EmptyStateComponent,
    PageOpenComponent,
    RouterLink,
    LoadFailedComponent,
    ChapterHeadComponent,
  ],
  templateUrl: './class-view.component.html',
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DialogService],
})
export class ClassViewComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly refData = inject(ReferenceDataService);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input<RouteObj>();

  protected readonly gradeOptions = GRADE_LEVELS.map((grade) => ({
    label: GRADE_LEVEL_LABELS[grade],
    value: grade,
  }));

  /**
   * 分校跟頂欄走（#1138）：這頁一定要一間分校才有東西看。日常頁的頂欄沒有「全部分校」
   * （#1607），所以頁內的分校下拉拿掉了。
   */
  private readonly campusCtx = inject(CampusContextService);
  protected readonly campusId = computed(() => this.campusCtx.id() ?? '');
  protected readonly searchText = signal('');
  protected readonly selectedGrades = signal<GradeLevel[]>([]);
  protected readonly subjectIdFilter = signal<string | null>(null);
  protected readonly todoOnly = signal(false);
  /** 篩選浮層開著與否（鈕的 aria-expanded）；外點擊關掉由 Popover 的 onHide 回寫 */
  protected readonly filtersOpen = signal(false);

  protected readonly courseGroups = signal<CourseGroup[]>([]);
  protected readonly loadingGroups = signal(true);
  /**
   * 取數失敗。**不能沿用 `filteredGroups().length === 0`** —— 那一格說
   * 「無符合的課程／請嘗試調整篩選條件」，也就是**叫使用者去做一件不會有用的事**（#812）。
   */
  protected readonly loadFailed = signal(false);
  protected readonly todoMap = signal<Record<string, TodoInfo>>({});
  protected readonly loadingTodoMap = signal(false);

  private todoMapRequestToken = 0;

  protected readonly subjectOptions = computed(() =>
    this.refData.subjects().map((subject) => ({
      label: subject.name,
      value: subject.id,
    })),
  );

  /** 色面標題的「N 個班」：這間分校載回來的開課班（不看搜尋與篩選） */
  protected readonly classCount = computed(() =>
    this.courseGroups().reduce((n, group) => n + group.classes.length, 0),
  );

  protected readonly todoClassCount = computed(
    () => Object.values(this.todoMap()).filter((todo) => todo.count > 0).length,
  );

  /** A6 篩選鈕上的「篩選：國一 · 數學」；沒條件是「全部」 */
  protected readonly filterSummary = computed(() => {
    const grades = this.selectedGrades().map((grade) => GRADE_LEVEL_LABELS[grade]);
    const subjectId = this.subjectIdFilter();
    const subject = subjectId
      ? this.subjectOptions().find((option) => option.value === subjectId)?.label
      : undefined;
    const parts = [grades.join('、'), subject].filter(Boolean);
    return parts.length ? parts.join(' · ') : '全部';
  });

  protected readonly hasFilters = computed(
    () => this.selectedGrades().length > 0 || !!this.subjectIdFilter(),
  );

  /** A6 的「顯示 N 個班（共 M）」：搜尋、篩選、待登錄任一有開就出現 */
  protected readonly narrowed = computed(
    () => !!this.searchText().trim() || this.hasFilters() || this.todoOnly(),
  );

  protected readonly shownClassCount = computed(() =>
    this.filteredGroups().reduce((n, group) => n + group.classes.length, 0),
  );

  protected readonly filteredGroups = computed<CourseGroup[]>(() => {
    const text = this.searchText().trim().toLowerCase();
    const selectedGrades = this.selectedGrades();
    const selectedSubjectId = this.subjectIdFilter();
    const todoOnly = this.todoOnly();

    return this.courseGroups()
      .filter((group) => !selectedSubjectId || group.subjectId === selectedSubjectId)
      .map((group) => {
        const classes = group.classes.filter((cls) => {
          const matchesText =
            !text ||
            cls.classInfo.name.toLowerCase().includes(text) ||
            group.courseName.toLowerCase().includes(text);
          const matchesGrade =
            selectedGrades.length === 0 ||
            cls.gradeLevels.some((grade) => selectedGrades.includes(grade));
          const matchesTodo = !todoOnly || this.getTodoExamCount(cls.classInfo.id) > 0;
          return matchesText && matchesGrade && matchesTodo;
        });

        return {
          ...group,
          classes,
        };
      })
      .filter((group) => group.classes.length > 0);
  });

  constructor() {
    this.campusCtx.use();
    // 分校一定下來（頂欄選的或預設）就載；頂欄換了再載
    toObservable(this.campusId)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => this.loadGroups());
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.refData.loadSubjects();
  }

  protected onSearchChange(text: string): void {
    this.searchText.set(text);
  }

  protected onGradeFilterChange(values: GradeLevel[] | null): void {
    this.selectedGrades.set(values ?? []);
  }

  protected onSubjectFilterChange(value: string | null): void {
    this.subjectIdFilter.set(value);
  }

  protected toggleTodoOnly(): void {
    this.todoOnly.update((value) => !value);
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.selectedGrades.set([]);
    this.subjectIdFilter.set(null);
    this.todoOnly.set(false);
  }

  protected getTodoExamCount(classId: string): number {
    return this.todoMap()[classId]?.count ?? 0;
  }

  protected todoExamId(classId: string): string | null {
    return this.todoMap()[classId]?.examId ?? null;
  }

  /** 平均是那一場自己的尺度；整數照印，其餘一位小數（同成績登錄頁） */
  protected formatAvg(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  /** A6「（10/12）」：不補零的月／日 */
  protected formatMonthDay(date: string): string {
    const [, month, day] = date.split('-').map(Number);
    return `${month}/${day}`;
  }

  protected openClassScores(cls: Class): void {
    this.dialogService.open(ClassScoresDialogComponent, {
      width: '900px',
      breakpoints: { '640px': '95%' },
      modal: true,
      showHeader: false,
      appendTo: 'body',
      contentStyle: {
        'max-height': 'calc(var(--window-height, 800px) * 0.85)',
        overflow: 'auto',
      },
      data: {
        class: cls,
        campusId: this.campusId() || null,
      },
    });
  }

  /** `protected` 而不是 `private`：失敗態的重試鈕要在模板裡呼叫它（#812） */
  protected loadGroups(): void {
    if (!this.campusId()) {
      this.courseGroups.set([]);
      this.todoMap.set({});
      this.loadingGroups.set(false);
      return;
    }

    this.loadingGroups.set(true);
    this.loadFailed.set(false);
    this.classesService
      .list({
        campusId: this.campusId(),
        isActive: true,
        pageSize: 0,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data: classes }) => {
          this.courseGroups.set(this.buildCourseGroups(classes));
          this.loadTodoExamCounts(classes);
          this.loadingGroups.set(false);
        },
        // **不再發 toast** —— 主體現在有常駐的失敗狀態；會消失的 toast 加留著的
        // 錯誤畫面是兩個互相矛盾的訊號（#788 的裁定）
        error: () => {
          this.loadFailed.set(true);
          this.courseGroups.set([]);
          this.todoMap.set({});
          this.loadingGroups.set(false);
        },
      });
  }

  private loadTodoExamCounts(classes: Class[]): void {
    const token = ++this.todoMapRequestToken;

    if (classes.length === 0) {
      this.todoMap.set({});
      this.loadingTodoMap.set(false);
      return;
    }

    this.loadingTodoMap.set(true);
    // 一支帶回每班的待登錄（#1782；原本是每班一支列表查詢）。失敗就當沒有待登錄，跟原本一樣
    this.academyExamsService
      .todoByClass(this.campusId())
      .pipe(
        map(({ data }) => data),
        catchError(() => of([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((items) => {
        if (token !== this.todoMapRequestToken) return;

        const next: Record<string, TodoInfo> = {};
        for (const { classId, count, firstExamId } of items) {
          next[classId] = { count, examId: firstExamId };
        }

        this.todoMap.set(next);
        this.loadingTodoMap.set(false);
      });
  }

  private buildCourseGroups(classes: Class[]): CourseGroup[] {
    const groups = new Map<string, CourseGroup>();

    for (const cls of classes) {
      const validGradeLevels = cls.gradeLevels.filter((grade): grade is GradeLevel =>
        (GRADE_LEVELS as readonly string[]).includes(grade),
      );

      const classItem: ClassItem = {
        classInfo: cls,
        gradeLabels: this.formatGradeRange(validGradeLevels),
        gradeLevels: validGradeLevels,
      };

      const existing = groups.get(cls.courseId);
      if (existing) {
        existing.classes.push(classItem);
        continue;
      }

      groups.set(cls.courseId, {
        courseId: cls.courseId,
        courseName: cls.courseName ?? '未命名課程',
        subjectId: cls.subjectId ?? null,
        subjectName: cls.subjectName ?? '未指定科目',
        gradeRange: this.formatGradeRange(validGradeLevels),
        classes: [classItem],
      });
    }

    return Array.from(groups.values());
  }

  private formatGradeRange(levels: GradeLevel[]): string {
    if (levels.length === 0) return '';
    if (levels.length === 1) return GRADE_LEVEL_LABELS[levels[0]];

    const sorted = [...levels].sort((a, b) => GRADE_LEVELS.indexOf(a) - GRADE_LEVELS.indexOf(b));
    const first = GRADE_LEVEL_LABELS[sorted[0]];
    const last = GRADE_LEVEL_LABELS[sorted[sorted.length - 1]];
    return first === last ? first : `${first}～${last}`;
  }
}
