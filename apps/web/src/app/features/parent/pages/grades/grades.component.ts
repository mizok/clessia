import { NgTemplateOutlet } from '@angular/common';
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

import { SelectModule } from 'primeng/select';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentGradesService,
  type ParentGradePeriod,
  type ParentScoreRecord,
} from '@core/parent-grades.service';
import { isFailingScore } from '@shared/utils/score-threshold.util';
import { BandAnchorComponent } from '@shared/components/page-band/band-anchor/band-anchor.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { format } from 'date-fns';
import {
  SCORE_STATUS_LABELS,
  defaultPeriodFilter,
  filterByPeriod,
  groupBySubject,
  periodOptions,
  type PeriodFilter,
} from './grades.util';

/**
 * **必須 ≤ API 的上限**（`apps/api/src/routes/parent/grades.ts` 的
 * `pageSize: …max(100)`）。原本寫 200 —— 超過上限，於是每一次請求都被 Zod 擋成
 * 400，**這一頁從來沒有載入成功過**，畫面永遠是「載入失敗」。
 *
 * 沒有人發現，是因為 seed 裡沒有任何 `parent` 角色，這一頁打不開（#518）。
 *
 * **改成 100 之後多出一個問題**：這一頁沒有分頁 UI，是一次撈完再前端篩。
 * 超過 100 筆就會被截斷，而**截斷是安靜的** —— 所以下面用 `meta.total`
 * 跟實際拿到的筆數比對，不一致就講出來。**不要把大聲的失敗換成安靜的截斷。**
 */
const PAGE_SIZE = 100;

@Component({
  selector: 'app-grades',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    SelectModule,
    PageBandComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    BandAnchorComponent,
    DataChipComponent,
    EmptyStateComponent,
  ],
  templateUrl: './grades.component.html',
})
export class GradesComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly gradesService = inject(ParentGradesService);

  protected readonly statusLabels = SCORE_STATUS_LABELS;

  /** 列的內容住在 ng-template 裡（可展開與不可展開兩種外框共用），那裡的 `let-` 變數沒有型別 */
  protected statusLabel(record: ParentScoreRecord): string {
    return this.statusLabels[record.status];
  }

  protected readonly records = signal<ParentScoreRecord[]>([]);
  protected readonly recentCount = signal(0);
  /** 伺服器說總共有幾筆 —— 用來偵測「這一頁只拿到前 N 筆」 */
  protected readonly total = signal(0);

  /** 被截斷了：拿到的比總數少。沒有分頁 UI，所以只能講出來 */
  protected readonly truncated = computed(() => this.total() > this.records().length);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  /** 機構的期（`billing_periods`）＝學期篩選的選項來源（#1076） */
  protected readonly periods = signal<ParentGradePeriod[]>([]);
  /** `null`＝使用者還沒選過，第一次拿到期清單時套預設（含今天的期） */
  protected readonly periodFilter = signal<PeriodFilter | null>(null);
  protected readonly periodOptions = computed(() => periodOptions(this.periods(), this.records()));
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
    return filterByPeriod(bySubject, this.periodFilter() ?? 'all', this.periods());
  });

  protected readonly groups = computed(() => groupBySubject(this.filteredRecords()));

  constructor() {
    effect(() => {
      const childId = this.childScope.activeChildId();
      if (!childId) return;
      untracked(() => {
        // **換孩子 = 換一整組科目**，所以舊的科目篩選要一起丟掉（#703）。
        //
        // 不丟的話它不是「篩選殘留」這麼單純：`subjectOptions()` 是從 `records()`
        // 算出來的，舊科目在新孩子身上不存在 → `p-select` 解不出標籤 →
        // **退回顯示 placeholder「全部科目」**。篩選還在生效，控制項卻長得像沒有篩選，
        // 而空狀態文案跟「這個孩子真的沒有成績」一模一樣 —— 家長讀成後者。
        //
        // **學期篩選刻意不重設**：期是機構的，換孩子還是同一組期，選中的那個顯示得出來、
        // 不會騙人，所以使用者的選擇留著。會騙人的只有「值還在生效但畫面上消失」的那一個。
        this.subjectFilter.set(null);
        this.load(childId);
      });
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected onSubjectChange(subject: string | null): void {
    this.subjectFilter.set(subject);
  }

  protected onPeriodChange(filter: PeriodFilter | null): void {
    this.periodFilter.set(filter ?? 'all');
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
        this.total.set(res.meta.total);
        this.periods.set(res.meta.periods);
        if (this.periodFilter() === null) {
          this.periodFilter.set(
            defaultPeriodFilter(res.meta.periods, format(new Date(), 'yyyy-MM-dd')),
          );
        }
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
        this.records.set([]);
        this.recentCount.set(0);
        this.total.set(0);
      },
    });
  }
}
