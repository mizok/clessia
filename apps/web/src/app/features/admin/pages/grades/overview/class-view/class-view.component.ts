import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { type Class, ClassesService } from '@core/classes.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { AcademyExamsService } from '@core/academy-exams.service';
import { GRADE_LEVEL_LABELS, GRADE_LEVELS, type GradeLevel } from '@core/students.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { catchError, forkJoin, map, of } from 'rxjs';

import { ClassScoresDialogComponent } from './class-scores-dialog/class-scores-dialog.component';
import {
  ClassViewFilterDialogComponent,
  type ClassViewFilterDialogResult,
  type ClassViewFilterSnapshot,
} from './class-view-filter-dialog/class-view-filter-dialog.component';

interface ClassItem {
  readonly classInfo: Class;
  readonly gradeLabels: string;
  readonly gradeLevels: GradeLevel[];
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
    FormsModule,
    MultiSelectModule,
    SelectModule,
    InputTextModule,
    EmptyStateComponent,
    PageBreadcrumbComponent,
  ],
  templateUrl: './class-view.component.html',
  styleUrl: './class-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DialogService, MessageService],
})
export class ClassViewComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly refData = inject(ReferenceDataService);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input<RouteObj>();

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '成績總覽', routerLink: '/admin/grades/overview' },
    { label: '班級視角' },
  ];

  protected readonly gradeOptions = GRADE_LEVELS.map((grade) => ({
    label: GRADE_LEVEL_LABELS[grade],
    value: grade,
  }));

  protected readonly campusId = signal<string>('');
  protected readonly searchText = signal('');
  protected readonly selectedGrades = signal<GradeLevel[]>([]);
  protected readonly subjectIdFilter = signal<string | null>(null);
  protected readonly todoOnly = signal(false);

  protected readonly courseGroups = signal<CourseGroup[]>([]);
  protected readonly loadingGroups = signal(true);
  protected readonly todoExamCountMap = signal<Record<string, number>>({});
  protected readonly loadingTodoMap = signal(false);

  private todoMapRequestToken = 0;

  protected readonly campusOptions = computed(() =>
    this.refData.campuses().map((campus) => ({ label: campus.name, value: campus.id })),
  );

  protected readonly subjectOptions = computed(() =>
    this.refData.subjects().map((subject) => ({
      label: subject.name,
      value: subject.id,
    })),
  );

  protected readonly todoClassCount = computed(
    () => Object.values(this.todoExamCountMap()).filter((count) => count > 0).length,
  );

  protected readonly mobileFilterCount = computed(() => {
    let count = 0;
    if (this.selectedGrades().length > 0) count += 1;
    if (this.subjectIdFilter()) count += 1;
    return count;
  });

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
    effect(() => {
      const campuses = this.refData.campuses();
      if (campuses.length === 0) return;
      if (untracked(() => this.campusId())) return;
      this.campusId.set(campuses[0].id);
      this.loadGroups();
    });
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.refData.loadSubjects();
  }

  protected onCampusChange(id: string): void {
    this.campusId.set(id);
    this.loadGroups();
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

  protected openMobileFilterDialog(): void {
    const ref = this.dialogService.open(ClassViewFilterDialogComponent, {
      width: '420px',
      breakpoints: { '640px': '95%' },
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        initial: {
          campusId: this.campusId(),
          search: this.searchText(),
          selectedGrades: this.selectedGrades(),
          subjectId: this.subjectIdFilter(),
        },
        options: {
          campusOptions: this.campusOptions(),
          gradeOptions: this.gradeOptions,
          subjectOptions: this.subjectOptions(),
        },
      },
    });

    if (!ref) return;

    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result?: ClassViewFilterDialogResult) => {
        if (!result) return;
        if (result.cleared) {
          this.searchText.set('');
          this.selectedGrades.set([]);
          this.subjectIdFilter.set(null);
          return;
        }
        if (!result.snapshot) return;
        this.applyMobileFilterSnapshot(result.snapshot);
      });
  }

  protected getTodoExamCount(classId: string): number {
    return this.todoExamCountMap()[classId] ?? 0;
  }

  protected openClassScores(cls: Class, todoOnly = false): void {
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
        todoOnly,
      },
    });
  }

  private loadGroups(): void {
    if (!this.campusId()) {
      this.courseGroups.set([]);
      this.todoExamCountMap.set({});
      this.loadingGroups.set(false);
      return;
    }

    this.loadingGroups.set(true);
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
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入課程/班級列表',
          });
          this.courseGroups.set([]);
          this.todoExamCountMap.set({});
          this.loadingGroups.set(false);
        },
      });
  }

  private loadTodoExamCounts(classes: Class[]): void {
    const token = ++this.todoMapRequestToken;
    const classIds = classes.map((cls) => cls.id);

    if (classIds.length === 0) {
      this.todoExamCountMap.set({});
      this.loadingTodoMap.set(false);
      return;
    }

    this.loadingTodoMap.set(true);
    const requests = classIds.map((classId) =>
      this.academyExamsService.list({ classId, todo: true, pageSize: 1 }).pipe(
        map((res) => ({ classId, count: res.meta.total })),
        catchError(() => of({ classId, count: 0 })),
      ),
    );

    forkJoin(requests)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((items) => {
        if (token !== this.todoMapRequestToken) return;

        const next: Record<string, number> = {};
        for (const item of items) {
          next[item.classId] = item.count;
        }

        this.todoExamCountMap.set(next);
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

  private applyMobileFilterSnapshot(snapshot: ClassViewFilterSnapshot): void {
    const prevCampusId = this.campusId();
    const nextCampusId = snapshot.campusId;

    this.searchText.set(snapshot.search);
    this.selectedGrades.set(snapshot.selectedGrades);
    this.subjectIdFilter.set(snapshot.subjectId);

    if (prevCampusId !== nextCampusId) {
      this.onCampusChange(nextCampusId);
    }
  }
}
