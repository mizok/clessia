import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import type { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  REVENUE_GROUP_BY_LABELS,
  ReportsService,
  type RevenueFigures,
  type RevenueGroup,
  type RevenueGroupBy,
} from '@core/reports.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { CoursesService, type Course } from '@core/courses.service';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';

import { defaultRange, groupKeyLabel, isAmbiguousKey,
  splitBilled,
} from './reports.util';

/**
 * 營收報表 —— 見 kb/wiki/specs/admin/finance/reports.md。
 *
 * **這一頁一個數字都不自己加。** spec 的 🔴 實作陷阱：列表 API 的 `pageSize` 上限是
 * 100，抓一頁明細自己加總會在量大的月份**悄悄少算而且錯得沒有任何徵兆** ——
 * 報表看起來完全正常，只是數字是錯的。所有數字都來自 `/api/reports/revenue`
 * 的 `summary` 與 `groups`。
 *
 * **退款單獨列不跟實收淨額混算**：「收了 10 萬、退了 3 萬」與「收了 7 萬」是兩個
 * 不同的經營訊號，壓成一個數字就看不出退費在發生。
 *
 * **模糊桶照實顯示。** 一張帳單可以跨班也可以完全沒有班，後端刻意不做比例拆分、
 * 也不重複計入多個組，而是給一個看得見的 `（跨分校）` / `（未分類）` ——
 * 換來的是小計永遠加得回總計。**不要藏、不要合併、不要重新命名它們**，
 * 那會讓模糊變成隱形。
 *
 * 權限是 `view_reports`（唯讀）不是 `manage_finance`（會寫）——
 * 路由已掛 `permissionGuard('view_reports')`，照 dashboard 經營區的先例。
 */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    SelectButtonModule,
    TagModule,
    ToastModule,
    TooltipModule,
    EmptyStateComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService],
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.scss',
})
export class ReportsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly service = inject(ReportsService);
  private readonly refData = inject(ReferenceDataService);
  private readonly coursesService = inject(CoursesService);

  protected readonly summary = signal<RevenueFigures | null>(null);
  protected readonly groups = signal<RevenueGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly groupBy = signal<RevenueGroupBy>('campus');
  protected readonly campusId = signal<string | null>(null);
  protected readonly courseId = signal<string | null>(null);
  protected readonly courses = signal<Course[]>([]);

  protected dateRange: Date[] | null = initialRange();

  protected readonly groupByOptions = (
    Object.keys(REVENUE_GROUP_BY_LABELS) as RevenueGroupBy[]
  ).map((value) => ({ value, label: REVENUE_GROUP_BY_LABELS[value] }));

  protected readonly campusOptions = computed(() => [
    { label: '全部分校', value: null },
    ...this.refData
      .campuses()
      .filter((campus) => campus.isActive)
      .map((campus) => ({ label: campus.name, value: campus.id })),
  ]);

  protected readonly courseOptions = computed(() => [
    { label: '全部課程', value: null },
    ...this.courses().map((course) => ({ label: course.name, value: course.id })),
  ]);

  /** 分組是不是切在「月份」—— 月份那欄的標題與格式不一樣 */
  protected readonly groupColumnLabel = computed(() => REVENUE_GROUP_BY_LABELS[this.groupBy()]);

  /**
   * 橘帶上那條流向的長度。用 `billed` / `outstanding` 這一組 ——
   * `received` 看的是收款日、`billed` 看的是開帳日，兩者是**不同的集合**，
   * 拿 `received / billed` 當收款率是在比不同母體（見 `splitBilled` 的說明）。
   */
  protected readonly billedSplit = computed(() => {
    const s = this.summary();
    return s ? splitBilled(s) : null;
  });

  /** 一列自己的收款比例。同樣只用 billed / outstanding 這一組。 */
  protected collectedPctOf(group: RevenueGroup): number {
    return splitBilled(group).collectedPct;
  }

  protected readonly hasFilters = computed(
    () => this.campusId() !== null || this.courseId() !== null,
  );

  ngOnInit(): void {
    this.refData.loadCampuses();
    this.loadCourses();
    this.load();
  }

  private loadCourses(): void {
    // 篩選用的選項，一次撈完不分頁；失敗就只是少一個下拉，不擋報表
    this.coursesService.list({ isActive: true, pageSize: 200 }).subscribe({
      next: (res) => this.courses.set(res.data),
      error: () => this.courses.set([]),
    });
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    const { from, to } = rangeToStrings(this.dateRange);

    this.service
      .revenue({
        dateFrom: from,
        dateTo: to,
        campusId: this.campusId() ?? undefined,
        courseId: this.courseId() ?? undefined,
        groupBy: this.groupBy(),
      })
      .subscribe({
        next: (res) => {
          this.summary.set(res.summary);
          this.groups.set(res.groups);
          this.loading.set(false);
        },
        error: () => {
          // 清掉而不是留著 —— 舊數字配新篩選條件是最糟的騙法
          this.summary.set(null);
          this.groups.set([]);
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  protected onRangeChange(value: Date[] | null): void {
    this.dateRange = value;
    // range 模式選第一個日期時 end 還是 null，那時候查會查成單日
    if (!value || value.length < 2 || !value[1]) return;
    this.load();
  }

  protected onGroupByChange(value: RevenueGroupBy): void {
    if (this.groupBy() === value) return;
    this.groupBy.set(value);
    this.load();
  }

  protected onCampusChange(value: string | null): void {
    this.campusId.set(value);
    this.load();
  }

  protected onCourseChange(value: string | null): void {
    this.courseId.set(value);
    this.load();
  }

  protected clearFilters(): void {
    this.campusId.set(null);
    this.courseId.set(null);
    this.load();
  }

  protected labelOf(group: RevenueGroup): string {
    return groupKeyLabel(group.key, this.groupBy());
  }

  protected isAmbiguous(group: RevenueGroup): boolean {
    return isAmbiguousKey(group.key);
  }
}

function initialRange(): Date[] {
  const { from, to } = defaultRange(format(new Date(), 'yyyy-MM-dd'));
  return [new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`)];
}

/** 沒選滿區間就退回預設 —— `dateFrom`/`dateTo` 是後端的必填參數 */
function rangeToStrings(range: Date[] | null): { from: string; to: string } {
  if (!range || range.length < 2 || !range[0] || !range[1]) {
    return defaultRange(format(new Date(), 'yyyy-MM-dd'));
  }

  return {
    from: format(range[0], 'yyyy-MM-dd'),
    to: format(range[1], 'yyyy-MM-dd'),
  };
}
