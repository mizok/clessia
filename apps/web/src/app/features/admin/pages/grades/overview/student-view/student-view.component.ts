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

import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule } from 'primeng/paginator';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { subMonths } from 'date-fns';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { JdenticonAvatarComponent } from '@shared/components/jdenticon-avatar/jdenticon-avatar.component';
import {
  ScoresService,
  type ScoreRecord,
  type ScoreRecordType,
  type SubjectAverage,
} from '@core/scores.service';
import {
  StudentsService,
  type Student,
  type GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

type TypeFilter = 'all' | ScoreRecordType;
type TimeRange = 'all' | '1m' | '3m' | '6m';

interface SubjectOption {
  label: string;
  value: string;
}

const TYPE_OPTIONS: Array<{ label: string; value: TypeFilter }> = [
  { label: '全部', value: 'all' },
  { label: '補習班考試', value: 'academy' },
  { label: '學校考試', value: 'school' },
];

const TIME_RANGE_OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: '近1月', value: '1m' },
  { label: '近3月', value: '3m' },
  { label: '近半年', value: '6m' },
  { label: '全部', value: 'all' },
];

const GRADE_OPTIONS: Array<{ label: string; value: GradeLevel }> = GRADE_LEVELS.map((g) => ({
  label: GRADE_LEVEL_LABELS[g],
  value: g,
}));

const PAGE_SIZE = 8;

@Component({
  selector: 'app-student-view',
  standalone: true,
  imports: [
    FormsModule,
    SelectModule,
    SelectButtonModule,
    TagModule,
    InputTextModule,
    PaginatorModule,
    DialogModule,
    TooltipModule,
    EmptyStateComponent,
    PageBreadcrumbComponent,
    JdenticonAvatarComponent,
  ],
  templateUrl: './student-view.component.html',
  styleUrl: './student-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [MessageService],
})
export class StudentViewComponent implements OnInit {
  private readonly scoresService = inject(ScoresService);
  private readonly studentsService = inject(StudentsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input<RouteObj>();

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '成績總覽', routerLink: '/admin/grades/overview' },
    { label: '學生視角' },
  ];

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly timeRangeOptions = TIME_RANGE_OPTIONS;
  protected readonly gradeOptions = GRADE_OPTIONS;
  protected readonly PAGE_SIZE = PAGE_SIZE;

  // Filters (all optional — no filter = global search)
  protected readonly campusId = signal<string>('');
  protected readonly gradeFilter = signal<GradeLevel | ''>('');
  protected readonly searchText = signal('');

  // Student list state
  protected readonly studentList = signal<Student[]>([]);
  protected readonly loadingList = signal(true);
  protected readonly currentPage = signal(1);
  protected readonly totalStudents = signal(0);

  // Dialog state
  protected dialogVisible = false;
  protected readonly selectedStudent = signal<Student | null>(null);
  protected readonly scores = signal<ScoreRecord[]>([]);
  protected readonly summary = signal<SubjectAverage[]>([]);
  protected readonly loadingScores = signal(false);
  protected readonly loadingSummary = signal(false);
  protected readonly typeFilter = signal<TypeFilter>('all');
  protected readonly timeRange = signal<TimeRange>('all');
  protected readonly subjectFilter = signal<string | null>(null);
  protected readonly scorePage = signal(0);
  protected readonly SCORE_PAGE_SIZE = 10;

  protected readonly campusOptions = computed(() =>
    this.refData.campuses().map((c) => ({ label: c.name, value: c.id })),
  );

  protected readonly subjectOptions = computed<SubjectOption[]>(() => {
    const names = new Set<string>();
    for (const s of this.scores()) {
      if (s.subjectName) names.add(s.subjectName);
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((name) => ({ label: name, value: name }));
  });

  protected readonly filteredScores = computed(() => {
    const type = this.typeFilter();
    const range = this.timeRange();
    const subject = this.subjectFilter();
    let result = this.scores();

    if (type !== 'all') {
      result = result.filter((s) => s.type === type);
    }

    if (subject) {
      result = result.filter((s) => s.subjectName === subject);
    }

    if (range !== 'all') {
      const months = range === '1m' ? 1 : range === '3m' ? 3 : 6;
      const cutoff = subMonths(new Date(), months);
      result = result.filter((s) => new Date(s.examDate) >= cutoff);
    }

    return result;
  });

  protected readonly pagedScores = computed(() => {
    const all = this.filteredScores();
    const start = this.scorePage() * this.SCORE_PAGE_SIZE;
    return all.slice(start, start + this.SCORE_PAGE_SIZE);
  });

  constructor() {
    effect(() => {
      this.typeFilter();
      this.timeRange();
      this.subjectFilter();
      untracked(() => this.scorePage.set(0));
    });
  }

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.loadStudents();
  }

  protected onCampusChange(id: string | null): void {
    this.campusId.set(id ?? '');
    this.resetAndReload();
  }

  protected onGradeChange(grade: GradeLevel | null | ''): void {
    this.gradeFilter.set(grade ?? '');
    this.resetAndReload();
  }

  protected onSearchChange(text: string): void {
    this.searchText.set(text);
    this.resetAndReload();
  }

  protected onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadStudents();
  }

  protected selectStudent(student: Student): void {
    this.selectedStudent.set(student);
    this.scores.set([]);
    this.summary.set([]);
    this.typeFilter.set('all');
    this.timeRange.set('all');
    this.subjectFilter.set(null);
    this.scorePage.set(0);
    this.dialogVisible = true;
    this.loadScores(student.id);
    this.loadSummary(student.id);
  }

  protected onScorePageChange(event: { page?: number }): void {
    this.scorePage.set(event.page ?? 0);
  }

  protected onDialogHide(): void {
    this.selectedStudent.set(null);
    this.scores.set([]);
    this.summary.set([]);
  }

  protected formatGrade(grade: GradeLevel): string {
    return GRADE_LEVEL_LABELS[grade] ?? grade;
  }

  protected formatAvg(value: number | null): string {
    return value !== null ? String(value) : '—';
  }

  protected getTypeLabel(type: ScoreRecordType): string {
    return type === 'academy' ? '補習班' : '學校考試';
  }

  protected getTypeSeverity(type: ScoreRecordType): 'info' | 'contrast' {
    return type === 'academy' ? 'info' : 'contrast';
  }

  protected formatScore(score: number | null, totalScore: number | null): string {
    if (score === null) return '—';
    if (totalScore) return `${score} / ${totalScore}`;
    return String(score);
  }

  private resetAndReload(): void {
    this.selectedStudent.set(null);
    this.scores.set([]);
    this.summary.set([]);
    this.currentPage.set(1);
    this.loadStudents();
  }

  private loadStudents(): void {
    this.loadingList.set(true);
    this.studentsService
      .list({
        campusId: this.campusId() || undefined,
        grade: this.gradeFilter() || undefined,
        search: this.searchText() || undefined,
        searchScope: 'student_name',
        isActive: true,
        page: this.currentPage(),
        pageSize: PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.studentList.set(res.data);
          this.totalStudents.set(res.meta?.total ?? res.data.length);
          this.loadingList.set(false);
        },
        error: () => {
          this.studentList.set([]);
          this.totalStudents.set(0);
          this.loadingList.set(false);
        },
      });
  }

  private loadScores(studentId: string): void {
    this.loadingScores.set(true);
    this.scoresService
      .list({ studentId, pageSize: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const sorted = [...res.data].sort(
            (a, b) => new Date(b.examDate).getTime() - new Date(a.examDate).getTime(),
          );
          this.scores.set(sorted);
          this.loadingScores.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學生成績',
          });
          this.loadingScores.set(false);
        },
      });
  }

  private loadSummary(studentId: string): void {
    this.loadingSummary.set(true);
    this.scoresService
      .getStudentSummary(studentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.summary.set(res.data.subjects);
          this.loadingSummary.set(false);
        },
        error: () => {
          this.summary.set([]);
          this.loadingSummary.set(false);
        },
      });
  }
}
