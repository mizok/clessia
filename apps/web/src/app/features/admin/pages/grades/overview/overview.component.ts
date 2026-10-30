import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AcademyExamsService, type AcademyExam } from '@core/academy-exams.service';
import { ScoresService, type ScoresOverview } from '@core/scores.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { dateWithWeekday } from '../../students/detail/student-detail.util';

/**
 * 成績總覽入口（A6 grades.html，#991 grades G3）：開場標題（近 30 天幾場、幾場還沒登完）、
 * 還沒登完的清單、兩個視角與考試管理的連結。平均分、不及格學生、班平均最低、最近考試
 * 來自 `GET /scores/overview`（#1314 G5）。
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [SkeletonComponent, RouterLink, PageOpenComponent, LoadFailedComponent],
  templateUrl: './overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  readonly page = input<RouteObj>();
  private readonly academyExams = inject(AcademyExamsService);
  private readonly scores = inject(ScoresService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly pendingCount = signal(0);
  protected readonly pending = signal<AcademyExam[]>([]);
  protected readonly overview = signal<ScoresOverview | null>(null);
  /** 「看全部 N 位學生的成績」：學生視角列的是有成績的學生，同一個母體 */
  protected readonly studentTotal = signal(0);
  protected readonly dateWithWeekday = dateWithWeekday;
  protected readonly round = Math.round;

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    forkJoin({
      overview: this.scores.overview({ days: 30 }),
      students: this.scores.studentAggregatesAll({ pageSize: 1 }),
      // ponytail: 只列最舊的 50 場；待登錄超過 50 場時標題的數字仍是全部，清單後面看考試管理
      todo: this.academyExams.list({ todo: true, order: 'date_asc', pageSize: 50 }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ overview, students, todo }) => {
          this.overview.set(overview);
          this.studentTotal.set(students.meta.total);
          this.pendingCount.set(todo.meta.total);
          this.pending.set(todo.data);
          this.loading.set(false);
        },
        error: () => {
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  protected gradeLabel(grade: string | null): string {
    return grade ? (GRADE_LEVEL_LABELS[grade as GradeLevel] ?? grade) : '';
  }

  protected missing(exam: AcademyExam): number {
    return Math.max(0, exam.expectedCount - exam.scoreCount);
  }
}
