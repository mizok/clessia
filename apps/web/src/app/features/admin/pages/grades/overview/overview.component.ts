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
import { SystemClockService, addDaysToDateString } from '@core/system-clock.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';

/**
 * 成績總覽入口（A6 grades.html，#991 grades G3）。計畫席裁 Q6：只放現有 API 拿得到的 ——
 * 開場標題（近 30 天幾場、幾場還沒登完）、還沒登完的清單、兩個視角與考試管理的連結。
 * A6 的平均分、不及格學生、班平均最低、最近考試摘要都缺彙總 API，列 #991 後續項。
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [RouterLink, PageOpenComponent, LoadFailedComponent],
  templateUrl: './overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  readonly page = input<RouteObj>();
  private readonly academyExams = inject(AcademyExamsService);
  private readonly clock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly recentCount = signal(0);
  protected readonly pendingCount = signal(0);
  protected readonly pending = signal<AcademyExam[]>([]);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    const dateFrom = addDaysToDateString(this.clock.todayTaipei(), -30);
    forkJoin({
      recent: this.academyExams.list({ dateFrom, pageSize: 1 }),
      // ponytail: 只列最舊的 50 場；待登錄超過 50 場時標題的數字仍是全部，清單後面看考試管理
      todo: this.academyExams.list({ todo: true, order: 'date_asc', pageSize: 50 }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ recent, todo }) => {
          this.recentCount.set(recent.meta.total);
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

  protected missing(exam: AcademyExam): number {
    return Math.max(0, exam.expectedCount - exam.scoreCount);
  }
}
