import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { skip } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
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
import { CampusContextService } from '@core/campus-context.service';
import { CoursesService, type Course } from '@core/courses.service';
import { SystemClockService } from '@core/system-clock.service';
import { AuthService } from '@core/auth.service';

import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';

import {
  DEFAULT_PERIOD,
  groupKeyLabel,
  isAmbiguousKey,
  reportPeriods,
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
    RouterLink,
    ButtonModule,
    SelectModule,
    SelectButtonModule,
    ToastModule,
    TooltipModule,
    PageOpenComponent,
    EmptyStateComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService],
  templateUrl: './reports.page.html',
})
export class ReportsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly service = inject(ReportsService);
  private readonly coursesService = inject(CoursesService);

  protected readonly summary = signal<RevenueFigures | null>(null);
  protected readonly groups = signal<RevenueGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly groupBy = signal<RevenueGroupBy>('campus');
  /** 分校跟頂欄走（#1138）：頁內分校下拉拿掉 */
  private readonly campusCtx = inject(CampusContextService);
  private readonly campusId = this.campusCtx.id;
  protected readonly courseId = signal<string | null>(null);
  protected readonly courses = signal<Course[]>([]);

  private readonly systemClock = inject(SystemClockService);
  /** 月份下拉（RP1）：預設上個完整月。換算成 from/to 在 util，這裡只存選了哪一項 */
  protected readonly periodOptions = reportPeriods(this.systemClock.todayTaipei());
  protected readonly period = signal(DEFAULT_PERIOD);

  /**
   * 報表是 `view_reports`、帳單頁是 `manage_finance` —— 沒有後者的人點了連結會被擋，
   * 所以連到帳單頁的連結只給有權限的人（#1314 RP3）
   */
  protected readonly canOpenInvoices = inject(AuthService).hasPermission('manage_finance');

  protected readonly groupByOptions = (
    Object.keys(REVENUE_GROUP_BY_LABELS) as RevenueGroupBy[]
  ).map((value) => ({ value, label: REVENUE_GROUP_BY_LABELS[value] }));

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

  protected readonly hasFilters = computed(() => this.courseId() !== null);

  constructor() {
    this.campusCtx.use();
    // 初次載入由 ngOnInit 做；這裡只管之後頂欄換分校
    toObservable(this.campusId)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.load());
  }

  ngOnInit(): void {
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

    const { from, to } = this.periodOptions.find((o) => o.value === this.period())!;

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

  protected onPeriodChange(value: string): void {
    this.period.set(value);
    this.load();
  }

  protected onGroupByChange(value: RevenueGroupBy): void {
    if (this.groupBy() === value) return;
    this.groupBy.set(value);
    this.load();
  }

  protected onCourseChange(value: string | null): void {
    this.courseId.set(value);
    this.load();
  }

  protected clearFilters(): void {
    this.courseId.set(null);
    this.load();
  }

  protected readonly hasAmbiguousGroup = computed(() =>
    this.groups().some((group) => isAmbiguousKey(group.key)),
  );

  protected labelOf(group: RevenueGroup): string {
    return groupKeyLabel(group.key, this.groupBy());
  }

  /** 分組列名稱的連結（#1314 RP3）：模糊桶不連（它不是一個真的分校／課程）；帳單頁需要 manage_finance */
  protected linkOf(group: RevenueGroup): string | null {
    if (this.isAmbiguous(group)) return null;
    if (this.groupBy() === 'course') return '/admin/courses';
    return this.canOpenInvoices ? '/admin/payments' : null;
  }

  protected isAmbiguous(group: RevenueGroup): boolean {
    return isAmbiguousKey(group.key);
  }
}
