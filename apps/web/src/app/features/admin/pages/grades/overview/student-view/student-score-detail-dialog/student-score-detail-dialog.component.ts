import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { subMonths } from 'date-fns';

import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { PaginatorModule } from 'primeng/paginator';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { JdenticonAvatarComponent } from '@shared/components/jdenticon-avatar/jdenticon-avatar.component';
import {
  ScoresService,
  type ScoreRecord,
  type ScoreRecordType,
  type SubjectAverage,
} from '@core/scores.service';
import { GRADE_LEVEL_LABELS, type GradeLevel, type Student } from '@core/students.service';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';

type TypeFilter = 'all' | ScoreRecordType;
type TimeRange = 'all' | '1m' | '3m' | '6m';

interface SubjectOption {
  readonly label: string;
  readonly value: string;
}

interface StudentScoreDetailDialogData {
  readonly student: Student;
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

@Component({
  selector: 'app-student-score-detail-dialog',
  standalone: true,
  imports: [
    DataChipComponent,
    FormsModule,
    EmptyStateComponent,
    JdenticonAvatarComponent,
    PaginatorModule,
    SelectButtonModule,
    SelectModule,
    TooltipModule,
  ],
  templateUrl: './student-score-detail-dialog.component.html',
  styleUrl: './student-score-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentScoreDetailDialogComponent implements OnInit {
  private readonly scoresService = inject(ScoresService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<StudentScoreDetailDialogData>);

  protected readonly student = this.config.data?.student ?? null;

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly timeRangeOptions = TIME_RANGE_OPTIONS;

  protected readonly scores = signal<ScoreRecord[]>([]);
  protected readonly summary = signal<SubjectAverage[]>([]);
  protected readonly loadingScores = signal(false);
  protected readonly loadingSummary = signal(false);
  protected readonly typeFilter = signal<TypeFilter>('all');
  protected readonly timeRange = signal<TimeRange>('all');
  protected readonly subjectFilter = signal<string | null>(null);
  protected readonly scorePage = signal(0);
  protected readonly scorePageSize = 10;

  protected readonly subjectOptions = computed<SubjectOption[]>(() => {
    const names = new Set<string>();
    for (const score of this.scores()) {
      if (score.subjectName) names.add(score.subjectName);
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
      result = result.filter((score) => score.type === type);
    }

    if (subject) {
      result = result.filter((score) => score.subjectName === subject);
    }

    if (range !== 'all') {
      const months = range === '1m' ? 1 : range === '3m' ? 3 : 6;
      const cutoff = subMonths(new Date(), months);
      result = result.filter((score) => new Date(score.examDate) >= cutoff);
    }

    return result;
  });

  protected readonly pagedScores = computed(() => {
    const all = this.filteredScores();
    const start = this.scorePage() * this.scorePageSize;
    return all.slice(start, start + this.scorePageSize);
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
    if (!this.student) {
      this.ref.close();
      return;
    }

    this.loadScores(this.student.id);
    this.loadSummary(this.student.id);
  }

  protected close(): void {
    this.ref.close();
  }

  protected onScorePageChange(event: { page?: number }): void {
    this.scorePage.set(event.page ?? 0);
  }

  protected onTypeChange(value: TypeFilter | null): void {
    this.typeFilter.set(value ?? 'all');
  }

  protected onSubjectChange(value: string | null): void {
    this.subjectFilter.set(value);
  }

  protected onTimeRangeChange(value: TimeRange | null): void {
    this.timeRange.set(value ?? 'all');
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

  protected formatScore(score: number | null, totalScore: number | null): string {
    if (score === null) return '—';
    if (totalScore) return `${score} / ${totalScore}`;
    return String(score);
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
