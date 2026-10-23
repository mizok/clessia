import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChildScopeService } from '@core/child-scope.service';
import { ParentMealsService, type ParentMealRecord } from '@core/parent-meals.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { SystemClockService } from '@core/system-clock.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import {
  SelectFieldComponent,
  type SelectFieldOption,
} from '@shared/components/select-field/select-field.component';
import { ChildScopeGateComponent } from '../../shared/child-scope-gate/child-scope-gate.component';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import {
  MAX_RANGE_MONTHS,
  type MealPeriod,
  dayLabel,
  groupByMonth,
  mealsCsv,
  monthLabel,
  nextMonthLabel,
  monthSpan,
  monthsBack,
  monthsToDates,
  periodMonths,
} from './meals.util';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

/**
 * 家長端餐費紀錄（A6 p-meals）：色面＝這個月幾餐、多少錢 → 工具列（期間、匯出）→ 每月一個摺疊區。
 * 資料是 `GET /api/me/meals`（#1117）：只有有訂的那天，沒有餐別、沒有行政備註，所以稿的那兩欄不畫。
 */
@Component({
  selector: 'app-meals',
  standalone: true,
  imports: [
    SkeletonComponent,
    DecimalPipe,
    RouterLink,
    PageOpenComponent,
    ChildSwitcherComponent,
    ChildScopeGateComponent,
    EmptyStateComponent,
    SelectFieldComponent,
  ],
  templateUrl: './meals.component.html',
})
export class MealsComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly mealsService = inject(ParentMealsService);
  /** 建構時取一次（同出缺席頁）：開著跨月不會自己換 */
  protected readonly today = inject(SystemClockService).todayTaipei();

  protected readonly periodOptions: SelectFieldOption<MealPeriod>[] = [
    { label: '近 3 個月', value: '3' },
    { label: '近 6 個月', value: '6' },
    { label: '指定月份範圍', value: 'custom' },
  ];
  protected readonly period = signal<MealPeriod>('3');
  protected readonly customFrom = signal(monthsBack(this.today, 3));
  protected readonly customTo = signal(this.today.slice(0, 7));
  protected readonly maxMonth = this.today.slice(0, 7);

  protected readonly records = signal<ParentMealRecord[]>([]);
  /** 本月（色面用）；跟工具列的期間無關 */
  protected readonly thisMonth = signal<ParentMealRecord[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  protected readonly childName = computed(() => this.childScope.activeChild()?.name ?? null);
  protected readonly range = computed(() =>
    periodMonths(this.period(), this.today, { from: this.customFrom(), to: this.customTo() }),
  );
  /** 指定範圍反了或超過 12 個月：API 會擋，這裡先說 */
  protected readonly rangeError = computed(() => {
    const span = monthSpan(...this.range());
    if (span < 1) return '開始月份要早於結束月份';
    if (span > MAX_RANGE_MONTHS) return `一次最多看 ${MAX_RANGE_MONTHS} 個月`;
    return null;
  });
  protected readonly months = computed(() => groupByMonth(this.records()));
  protected readonly rangeLabel = computed(() => {
    const [from, to] = this.range();
    return `${monthLabel(from, this.today)}～${monthLabel(to, this.today)}`;
  });
  protected readonly hero = computed(() => {
    const rows = this.thisMonth();
    if (!rows) return null;
    return {
      meals: rows.filter((r) => r.amount > 0).length,
      amount: rows.reduce((sum, r) => sum + r.amount, 0),
    };
  });
  /** 單價取最近一筆（行政改價後以新的為準）；沒有紀錄就不寫 */
  protected readonly unitPrice = computed(
    () => (this.thisMonth()?.[0] ?? this.records()[0])?.unitPrice ?? null,
  );

  protected readonly monthLabel = (month: string) => monthLabel(month, this.today);
  protected readonly dayLabel = dayLabel;
  protected readonly nextMonthLabel = nextMonthLabel;

  constructor() {
    effect(() => {
      const childId = this.childScope.activeChildId();
      if (!childId) return;
      this.loadThisMonth(childId);
    });
    effect(() => {
      const childId = this.childScope.activeChildId();
      const [from, to] = this.range();
      if (!childId || this.rangeError()) return;
      this.load(childId, from, to);
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected setPeriod(value: MealPeriod): void {
    this.period.set(value);
  }

  protected exportCsv(popover: HTMLElement): void {
    const url = URL.createObjectURL(
      new Blob([mealsCsv(this.records())], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.childName() ?? '孩子'}-餐費-${this.range().join('_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    popover.hidePopover();
  }

  /** A6：桌機貼著匯出鈕右緣往下開；手機是底部面板（CSS 管） */
  protected placeExport(event: Event, trigger: HTMLElement): void {
    const popover = event.target as HTMLElement;
    if ((event as ToggleEvent).newState !== 'open') return;
    if (matchMedia('(max-width: 860px)').matches) {
      popover.removeAttribute('style');
      return;
    }
    const box = trigger.getBoundingClientRect();
    Object.assign(popover.style, {
      position: 'fixed',
      left: `${Math.max(16, box.right - popover.offsetWidth)}px`,
      top: `${box.bottom + 8}px`,
    });
  }

  /** 色面也一樣：換孩子很快時，上一個孩子的本月回應晚到不能蓋掉（#1834 二讀） */
  private thisMonthSeq = 0;

  private loadThisMonth(childId: string): void {
    const month = this.today.slice(0, 7);
    const [dateFrom, dateTo] = monthsToDates(month, month, this.today);
    const seq = ++this.thisMonthSeq;
    // 先清掉：新孩子的回應到之前，色面不能還寫著上一個孩子的數字
    this.thisMonth.set(null);
    this.mealsService.list({ childId, dateFrom, dateTo }).subscribe({
      next: (res) => {
        if (seq === this.thisMonthSeq) this.thisMonth.set(res.data);
      },
      error: () => {
        if (seq === this.thisMonthSeq) this.thisMonth.set(null);
      },
    });
  }

  /** 換期間或換孩子很快時，慢回來的舊請求不能蓋掉新的 */
  private loadSeq = 0;

  private load(childId: string, from: string, to: string): void {
    const [dateFrom, dateTo] = monthsToDates(from, to, this.today);
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.failed.set(false);
    this.mealsService.list({ childId, dateFrom, dateTo }).subscribe({
      next: (res) => {
        if (seq !== this.loadSeq) return;
        this.records.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        if (seq !== this.loadSeq) return;
        this.records.set([]);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }
}
