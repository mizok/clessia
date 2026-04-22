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
import { forkJoin, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { ClassesService, type Class } from '@core/classes.service';
import { CoursesService, type Course } from '@core/courses.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { GRADE_LEVEL_LABELS, GRADE_LEVELS, type GradeLevel } from '@core/students.service';
import {
  AcademyExamsService,
  type AcademyExam,
} from '@core/academy-exams.service';
import {
  ScoresService,
  type ClassExamStats,
  type ClassExamScore,
  type ScoreRecordStatus,
} from '@core/scores.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

type ScoreStatusFilter = 'all' | ScoreRecordStatus;

const SCORE_STATUS_OPTIONS: Array<{ label: string; value: ScoreStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '已登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

interface ClassItem {
  id: string;
  name: string;
  maxStudents: number;
  gradeLabels: string;
}

interface CourseGroup {
  courseId: string;
  courseName: string;
  subjectName: string;
  gradeRange: string;
  classes: ClassItem[];
}

interface ExamOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-class-view',
  standalone: true,
  imports: [
    FormsModule,
    SelectModule,
    SelectButtonModule,
    TagModule,
    InputTextModule,
    EmptyStateComponent,
    PageBreadcrumbComponent,
  ],
  templateUrl: './class-view.component.html',
  styleUrl: './class-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [MessageService],
})
export class ClassViewComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly scoresService = inject(ScoresService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input<RouteObj>();

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '成績總覽', routerLink: '/admin/grades/overview' },
    { label: '班級視角' },
  ];

  protected readonly scoreStatusOptions = SCORE_STATUS_OPTIONS;

  // Filters
  protected readonly campusId = signal<string>('');
  protected readonly searchText = signal('');

  // Course groups
  protected readonly courseGroups = signal<CourseGroup[]>([]);
  protected readonly loadingGroups = signal(true);

  // Selected class & exam
  protected readonly selectedClassId = signal<string | null>(null);
  protected readonly selectedClassName = signal<string>('');
  protected readonly exams = signal<AcademyExam[]>([]);
  protected readonly selectedExamId = signal<string | null>(null);
  protected readonly loadingExams = signal(false);
  protected readonly stats = signal<ClassExamStats | null>(null);
  protected readonly loadingStats = signal(false);
  protected readonly scoreStatusFilter = signal<ScoreStatusFilter>('all');

  protected readonly campusOptions = computed(() =>
    this.refData.campuses().map((c) => ({ label: c.name, value: c.id })),
  );

  protected readonly filteredGroups = computed<CourseGroup[]>(() => {
    const text = this.searchText().trim().toLowerCase();
    if (!text) return this.courseGroups();
    return this.courseGroups()
      .map((g) => ({
        ...g,
        classes: g.classes.filter(
          (c) =>
            c.name.toLowerCase().includes(text) ||
            g.courseName.toLowerCase().includes(text),
        ),
      }))
      .filter((g) => g.classes.length > 0);
  });

  protected readonly examOptions = computed<ExamOption[]>(() =>
    this.exams().map((e) => ({
      label: `${e.name} (${e.examDate})`,
      value: e.id,
    })),
  );

  protected readonly sortedScores = computed<ClassExamScore[]>(() => {
    const s = this.stats();
    if (!s) return [];
    const statusFilter = this.scoreStatusFilter();
    let result = [...s.scores];
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }
    return result.sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
  });

  constructor() {
    // Auto-select first campus once campuses are loaded (if user hasn't picked one yet)
    effect(() => {
      const list = this.refData.campuses();
      if (list.length === 0) return;
      if (untracked(() => this.campusId())) return;
      this.campusId.set(list[0].id);
      this.loadGroups();
    });
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
  }

  protected onCampusChange(id: string): void {
    this.campusId.set(id);
    this.resetSelection();
    this.loadGroups();
  }

  protected onSearchChange(text: string): void {
    this.searchText.set(text);
  }

  protected selectClass(cls: ClassItem): void {
    if (this.selectedClassId() === cls.id) {
      this.resetSelection();
      return;
    }
    this.selectedClassId.set(cls.id);
    this.selectedClassName.set(cls.name);
    this.selectedExamId.set(null);
    this.stats.set(null);
    this.loadExamsForClass(cls.id);
  }

  protected onExamChange(examId: string | null): void {
    this.selectedExamId.set(examId);
    this.stats.set(null);
    this.scoreStatusFilter.set('all');

    const classId = this.selectedClassId();
    if (!examId || !classId) return;
    this.loadStats(classId, examId);
  }

  protected getStatusLabel(status: string): string {
    switch (status) {
      case 'scored':
        return '已登錄';
      case 'absent':
        return '缺考';
      case 'makeup':
        return '補考';
      default:
        return status;
    }
  }

  protected getStatusSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' {
    switch (status) {
      case 'scored':
        return 'success';
      case 'absent':
        return 'danger';
      case 'makeup':
        return 'warn';
      default:
        return 'info';
    }
  }

  private resetSelection(): void {
    this.selectedClassId.set(null);
    this.selectedClassName.set('');
    this.selectedExamId.set(null);
    this.exams.set([]);
    this.stats.set(null);
  }

  private loadGroups(): void {
    if (!this.campusId()) {
      this.courseGroups.set([]);
      this.loadingGroups.set(false);
      return;
    }
    this.loadingGroups.set(true);
    this.coursesService
      .list({ campusId: this.campusId(), isActive: true, pageSize: 100 })
      .pipe(
        switchMap(({ data: courses }) => {
          if (courses.length === 0) return of<CourseGroup[]>([]);
          return forkJoin(
            courses.map((course) =>
              this.classesService
                .list({
                  courseId: course.id,
                  campusId: this.campusId(),
                  isActive: true,
                  pageSize: 100,
                })
                .pipe(
                  map(({ data: classes }) =>
                    this.buildCourseGroup(course, classes),
                  ),
                ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (groups) => {
          this.courseGroups.set(groups.filter((g) => g.classes.length > 0));
          this.loadingGroups.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入課程/班級列表',
          });
          this.courseGroups.set([]);
          this.loadingGroups.set(false);
        },
      });
  }

  private buildCourseGroup(course: Course, classes: Class[]): CourseGroup {
    return {
      courseId: course.id,
      courseName: course.name,
      subjectName: course.subjectName,
      gradeRange: this.formatGradeRange(course.gradeLevels),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        maxStudents: c.maxStudents,
        gradeLabels: this.formatGradeRange(c.gradeLevels),
      })),
    };
  }

  private formatGradeRange(levels: string[]): string {
    if (!levels || levels.length === 0) return '';
    const valid = levels.filter((g): g is GradeLevel =>
      (GRADE_LEVELS as readonly string[]).includes(g),
    );
    if (valid.length === 0) return '';
    if (valid.length === 1) return GRADE_LEVEL_LABELS[valid[0]];
    const sorted = [...valid].sort(
      (a, b) => GRADE_LEVELS.indexOf(a) - GRADE_LEVELS.indexOf(b),
    );
    const first = GRADE_LEVEL_LABELS[sorted[0]];
    const last = GRADE_LEVEL_LABELS[sorted[sorted.length - 1]];
    return first === last ? first : `${first}～${last}`;
  }

  private loadExamsForClass(classId: string): void {
    this.loadingExams.set(true);
    this.academyExamsService
      .list({ classId, pageSize: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.exams.set(res.data);
          this.loadingExams.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入考試列表',
          });
          this.loadingExams.set(false);
        },
      });
  }

  private loadStats(classId: string, examId: string): void {
    this.loadingStats.set(true);
    this.scoresService
      .getClassExamStats(classId, examId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res.data);
          this.loadingStats.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入班級成績統計',
          });
          this.loadingStats.set(false);
        },
      });
  }
}
