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
import { subDays, format, startOfMonth, endOfMonth } from 'date-fns';

import { DatePickerModule } from 'primeng/datepicker';
import { SelectButtonModule } from 'primeng/selectbutton';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { ChildScopeService } from '@core/child-scope.service';
import {
  ParentAttendanceService,
  type ParentAttendanceRecord,
} from '@core/parent-attendance.service';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';
import { todayLocal } from '@shared/utils/session-time.util';
import { ChildSwitcherComponent } from '../../shared/child-switcher/child-switcher.component';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONE,
  fillMissingDays,
  groupByDate,
} from './attendance.util';

type RangeMode = 'recent10' | 'recent30' | 'month';

const RANGE_OPTIONS: Array<{ label: string; value: RangeMode }> = [
  { label: '近10天', value: 'recent10' },
  { label: '近30天', value: 'recent30' },
  { label: '選月份', value: 'month' },
];

const PAGE_SIZE = 50;

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    FormsModule,
    DatePickerModule,
    SelectButtonModule,
    PageBandComponent,
    ChildSwitcherComponent,
    StatusDotComponent,
    EmptyStateComponent,
  ],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly childScope = inject(ChildScopeService);
  private readonly attendanceService = inject(ParentAttendanceService);

  protected readonly rangeOptions = RANGE_OPTIONS;
  protected readonly rangeMode = signal<RangeMode>('recent10');
  protected readonly selectedMonth = signal<Date>(new Date());

  protected readonly records = signal<ParentAttendanceRecord[]>([]);
  protected readonly total = signal(0);
  protected readonly page_ = signal(1);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly expandedId = signal<string | null>(null);

  /**
   * 近10天補回沒有紀錄的日期（「今日無課」）——短區間裡缺一天會被誤讀成
   * 「那天資料沒進來」，跟長區間不同。近30天/整月不補，那會炸出大量空白列。
   */
  protected readonly groups = computed(() => {
    const raw = groupByDate(this.records());
    if (this.rangeMode() !== 'recent10') return raw;
    const { dateFrom } = this.dateRange();
    if (!dateFrom) return raw;
    return fillMissingDays(raw, dateFrom, todayLocal());
  });
  protected readonly hasMore = computed(() => this.records().length < this.total());
  protected readonly statusLabels = ATTENDANCE_STATUS_LABELS;
  protected readonly statusTone = ATTENDANCE_STATUS_TONE;

  private readonly dateRange = computed<{ dateFrom?: string; dateTo?: string }>(() => {
    const mode = this.rangeMode();
    const now = new Date();
    if (mode === 'recent10') return { dateFrom: format(subDays(now, 10), 'yyyy-MM-dd') };
    if (mode === 'recent30') return { dateFrom: format(subDays(now, 30), 'yyyy-MM-dd') };
    const month = this.selectedMonth();
    return {
      dateFrom: format(startOfMonth(month), 'yyyy-MM-dd'),
      dateTo: format(endOfMonth(month), 'yyyy-MM-dd'),
    };
  });

  constructor() {
    // 孩子切換器換孩子、或篩選條件變了都要重新查——這三頁是切換器真正要驅動的東西，
    // 不像 02 片試點的 dashboard 只是擺著看
    effect(() => {
      const childId = this.childScope.activeChildId();
      this.dateRange();
      if (!childId) return;
      untracked(() => this.load(childId, 1));
    });
  }

  ngOnInit(): void {
    this.childScope.load();
  }

  protected onRangeChange(mode: RangeMode | null): void {
    this.rangeMode.set(mode ?? 'recent10');
  }

  protected onMonthChange(month: Date | null): void {
    this.selectedMonth.set(month ?? new Date());
  }

  protected toggleExpanded(record: ParentAttendanceRecord): void {
    this.expandedId.set(this.expandedId() === record.id ? null : record.id);
  }

  protected loadMore(): void {
    const childId = this.childScope.activeChildId();
    if (!childId) return;
    this.load(childId, this.page_() + 1, true);
  }

  private load(childId: string, page: number, append = false): void {
    this.loading.set(true);
    this.failed.set(false);
    const { dateFrom, dateTo } = this.dateRange();

    this.attendanceService
      .list({ childId, dateFrom, dateTo, page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.records.set(append ? [...this.records(), ...res.data] : res.data);
          this.total.set(res.meta.total);
          this.page_.set(page);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
          if (!append) {
            this.records.set([]);
            this.total.set(0);
          }
        },
      });
  }
}
