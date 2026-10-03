import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { MessageService } from 'primeng/api';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { AcademyExamsService, type AcademyExam } from '@core/academy-exams.service';
import { type Class } from '@core/classes.service';
import {
  ScoresService,
  type ClassExamScore,
  type ClassExamStats,
  type ScoreRecordStatus,
} from '@core/scores.service';
import { GRADE_LEVEL_LABELS, GRADE_LEVELS, type GradeLevel } from '@core/students.service';
import { PASSING_RATIO, isFailingScore } from '@shared/utils/score-threshold.util';

type ScoreStatusFilter = 'all' | ScoreRecordStatus;
type ExamScopeFilter = 'todo' | 'all';

interface ClassScoresDialogData {
  readonly class: Class;
  readonly campusId: string | null;
  readonly todoOnly?: boolean;
}

interface ExamOption {
  readonly label: string;
  readonly value: string;
}

interface ExamScopeOption {
  readonly label: string;
  readonly value: ExamScopeFilter;
}

const SCORE_STATUS_OPTIONS: Array<{ label: string; value: ScoreStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '已登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];

const EXAM_SCOPE_OPTIONS: ExamScopeOption[] = [
  { label: '待登錄', value: 'todo' },
  { label: '全部', value: 'all' },
];

const EXAM_TYPE_LABELS: Record<AcademyExam['examType'], string> = {
  quiz: '小考',
  mock_exam: '模擬考',
  placement_test: '分班考',
};

@Component({
  selector: 'app-class-scores-dialog',
  standalone: true,
  imports: [FormsModule, EmptyStateComponent, SelectModule],
  templateUrl: './class-scores-dialog.component.html',
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassScoresDialogComponent implements OnInit {
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly scoresService = inject(ScoresService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ClassScoresDialogData>);

  protected readonly classData: Class | null = this.config.data?.class ?? null;
  protected readonly scoreStatusOptions = SCORE_STATUS_OPTIONS;
  protected readonly examScopeOptions = EXAM_SCOPE_OPTIONS;

  protected readonly exams = signal<AcademyExam[]>([]);
  protected readonly selectedExamId = signal<string | null>(null);
  protected readonly loadingExams = signal(false);
  protected readonly stats = signal<ClassExamStats | null>(null);
  protected readonly loadingStats = signal(false);
  protected readonly scoreStatusFilter = signal<ScoreStatusFilter>('all');
  protected readonly examScope = signal<ExamScopeFilter>(
    this.config.data?.todoOnly === true ? 'todo' : 'all',
  );

  protected readonly examOptions = computed<ExamOption[]>(() =>
    this.exams().map((exam) => ({
      label: `${exam.name} (${exam.examDate})`,
      value: exam.id,
    })),
  );

  /** 目前選的這場考試——`exams` 列表項本來就有 totalScore/passScore，不用另外打 API */
  protected readonly selectedExam = computed(
    () => this.exams().find((exam) => exam.id === this.selectedExamId()) ?? null,
  );

  protected readonly sortedScores = computed<ClassExamScore[]>(() => {
    const currentStats = this.stats();
    if (!currentStats) return [];

    const statusFilter = this.scoreStatusFilter();
    let result = [...currentStats.scores];
    if (statusFilter !== 'all') {
      result = result.filter((row) => row.status === statusFilter);
    }

    return result.sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
  });

  /** 名單篩選各類人數（A6 的「全部 N／已登錄 N…」）。待登錄刻意不做：API 把沒成績的人回成 scored（#991 grades Q4） */
  protected readonly scoreCounts = computed(() => {
    const rows = this.stats()?.scores ?? [];
    const count = (status: ScoreRecordStatus) => rows.filter((r) => r.status === status).length;
    return {
      all: rows.length,
      scored: count('scored'),
      absent: count('absent'),
      makeup: count('makeup'),
    };
  });

  protected readonly failCount = computed(
    () => (this.stats()?.scores ?? []).filter((r) => this.isFailing(r.score)).length,
  );

  /** 及格線（給標籤看）：跟 isFailing 同一套退路 —— 及格線 → 總分六成 → 60 */
  protected readonly passLine = computed(() => {
    const exam = this.selectedExam();
    if (exam?.passScore != null) return exam.passScore;
    return Math.round((exam?.totalScore || 100) * PASSING_RATIO);
  });

  /**
   * 分數分布（A6 .dist）：依總分的 90／80／70／60% 切五段，整段落在及格線以下的標紅。
   * 只算有分數的人（缺考、未登錄不進分布）。
   */
  protected readonly distribution = computed(() => {
    const total = this.selectedExam()?.totalScore || 100;
    const values = (this.stats()?.scores ?? [])
      .map((r) => r.score)
      .filter((v): v is number => v !== null);
    const cuts = [0.9, 0.8, 0.7, 0.6].map((r) => Math.ceil(total * r));
    const bands = cuts.map((lo, i) => ({
      label: `${lo}–${i === 0 ? total : cuts[i - 1] - 1}`,
      lo,
      hi: i === 0 ? Infinity : cuts[i - 1],
    }));
    bands.push({ label: `未滿 ${cuts[3]}`, lo: -Infinity, hi: cuts[3] });
    const pass = this.passLine();
    const rows = bands.map((b) => ({
      label: b.label,
      n: values.filter((v) => v >= b.lo && v < b.hi).length,
      fail: b.hi <= pass,
    }));
    const max = Math.max(1, ...rows.map((r) => r.n));
    return rows.map((r) => ({ ...r, pct: (r.n / max) * 100 }));
  });

  protected readonly classGradeLabels = computed(() => {
    const gradeLevels: string[] = this.classData?.gradeLevels ?? [];
    const validLevels = gradeLevels.filter((grade): grade is GradeLevel =>
      (GRADE_LEVELS as readonly string[]).includes(grade),
    );

    if (validLevels.length === 0) return '';
    if (validLevels.length === 1) return GRADE_LEVEL_LABELS[validLevels[0]];

    const sorted = [...validLevels].sort(
      (a, b) => GRADE_LEVELS.indexOf(a) - GRADE_LEVELS.indexOf(b),
    );
    const first = GRADE_LEVEL_LABELS[sorted[0]];
    const last = GRADE_LEVEL_LABELS[sorted[sorted.length - 1]];
    return first === last ? first : `${first}～${last}`;
  });

  ngOnInit(): void {
    if (!this.classData) {
      this.ref.close();
      return;
    }

    this.loadExamsForClass(this.classData.id);
  }

  /**
   * 不及格 —— 有設定及格線就用它，沒有才退回這場考試總分的 60%
   * （`exams` 列表項本來就帶 totalScore/passScore，這裡不用再猜）。
   */
  protected isFailing(score: number | null): boolean {
    const exam = this.selectedExam();
    return isFailingScore(score, { passScore: exam?.passScore, totalScore: exam?.totalScore });
  }

  protected close(): void {
    this.ref.close();
  }

  protected onExamScopeChange(scope: ExamScopeFilter | null): void {
    const nextScope: ExamScopeFilter = scope ?? 'all';
    if (!this.classData || this.examScope() === nextScope) return;

    this.examScope.set(nextScope);
    this.loadExamsForClass(this.classData.id);
  }

  protected onExamChange(examId: string | null): void {
    this.selectedExamId.set(examId);
    this.stats.set(null);
    this.scoreStatusFilter.set('all');

    if (!examId || !this.classData) return;
    this.loadStats(this.classData.id, examId);
  }

  protected goToScoreEntry(exam: AcademyExam): void {
    this.router.navigate(['/admin/grades/exams', 'academy', exam.id, 'scores']);
    this.ref.close();
  }

  protected goToClassDetail(): void {
    if (!this.classData) return;
    this.router.navigate(['/admin/courses', this.classData.courseId, 'classes', this.classData.id]);
    this.ref.close();
  }

  protected getExamTypeLabel(examType: AcademyExam['examType']): string {
    return EXAM_TYPE_LABELS[examType];
  }

  protected formatDate(date: string | null): string {
    if (!date) return '—';
    return date;
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

  private loadExamsForClass(classId: string): void {
    const isTodoOnly = this.examScope() === 'todo';

    this.loadingExams.set(true);
    this.exams.set([]);
    this.selectedExamId.set(null);
    this.stats.set(null);
    this.scoreStatusFilter.set('all');

    this.academyExamsService
      .list(
        isTodoOnly
          ? { classId, todo: true, order: 'date_asc', pageSize: 200 }
          : { classId, pageSize: 200 },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.exams.set(res.data);
          if (!isTodoOnly && res.data.length > 0) {
            this.onExamChange(res.data[0].id);
          }
          this.loadingExams.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: isTodoOnly ? '無法載入待登錄考試列表' : '無法載入考試列表',
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
