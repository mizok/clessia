import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import { ParentGradesService, type ParentScoreRecord } from '@core/parent-grades.service';
import { isFailingScore } from '@shared/utils/score-threshold.util';
import { BandAnchorComponent } from '@shared/components/page-band/band-anchor/band-anchor.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import {
  SCORE_STATUS_LABELS,
  TIME_RANGE_OPTIONS,
  filterByTimeRange,
  groupBySubject,
  type TimeRange,
} from './grades.util';

const PAGE_SIZE = 200;

@Component({
  selector: 'app-grades',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    SelectModule,
    PageBandComponent,
    ChildSwitcherComponent,
    BandAnchorComponent,
    DataChipComponent,
    EmptyStateComponent,
  ],
  templateUrl: './grades.component.html',
  styleUrl: './grades.component.scss',
})
export class GradesComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly gradesService = inject(ParentGradesService);

  protected readonly timeRangeOptions = TIME_RANGE_OPTIONS;
  protected readonly statusLabels = SCORE_STATUS_LABELS;

  protected readonly records = signal<ParentScoreRecord[]>([]);
  protected readonly recentCount = signal(0);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly timeRange = signal<TimeRange>('all');
  protected readonly subjectFilter = signal<string | null>(null);

  protected readonly subjectOptions = computed(() => {
    const names = new Set<string>();
    for (const record of this.records()) {
      if (record.subjectName) names.add(record.subjectName);
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((name) => ({ label: name, value: name }));
  });

  private readonly filteredRecords = computed(() => {
    const bySubject = this.subjectFilter()
      ? this.records().filter((r) => r.subjectName === this.subjectFilter())
      : this.records();
    return filterByTimeRange(bySubject, this.timeRange(), new Date());
  });

  protected readonly groups = computed(() => groupBySubject(this.filteredRecords()));

  constructor() {
    effect(() => {
      const childId = this.childScope.activeChildId();
      if (!childId) return;
      untracked(() => this.load(childId));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected onSubjectChange(subject: string | null): void {
    this.subjectFilter.set(subject);
  }

  protected onTimeRangeChange(range: TimeRange | null): void {
    this.timeRange.set(range ?? 'all');
  }

  /**
   * 及格判斷不傳 `passScore`——`GET /api/me/grades` 目前不回這個欄位，
   * 純函式的三層退路本來就是為了這裡：拿不到就退化成總分比例，不是報錯。
   */
  protected isFailing(record: ParentScoreRecord): boolean {
    return isFailingScore(record.score, { totalScore: record.totalScore });
  }

  protected formatScore(record: ParentScoreRecord): string {
    if (record.score === null) return '—';
    if (record.totalScore) return `${record.score} / ${record.totalScore}`;
    return String(record.score);
  }

  private load(childId: string): void {
    this.loading.set(true);
    this.failed.set(false);

    this.gradesService.list({ childId, pageSize: PAGE_SIZE }).subscribe({
      next: (res) => {
        this.records.set(res.data);
        this.recentCount.set(res.meta.recentCount);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
        this.records.set([]);
        this.recentCount.set(0);
      },
    });
  }
}
