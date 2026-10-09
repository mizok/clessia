import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { skip } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { PaginatorModule } from 'primeng/paginator';

import { CampusContextService } from '@core/campus-context.service';
import { CampusScopeNoteComponent } from '@shared/components/campus-scope-note/campus-scope-note.component';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SystemClockService } from '@core/system-clock.service';
import { ChangeLogListComponent } from '@shared/components/change-log-list/change-log-list.component';
import { CHANGE_TYPE_LABELS } from '@shared/components/change-log-list/change-log.util';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

const PAGE_SIZE = LIST_PAGE_SIZE;
const MONTHS_BACK = 12;

/**
 * **有標籤但不給篩的類型。**
 *
 * - `creation` —— 後端合成的，不是真的 enum 值，篩不到
 * - `makeup` —— **後端還不收**：`ChangeLogQuerySchema.changeType`
 *   （`apps/api/src/routes/sessions.ts`）的 `z.enum` 目前沒有 `makeup`，
 *   送過去會被 zod 擋成 400。**給一個必然出錯的選項比不給更糟** ——
 *   使用者會以為「補課這個月沒有」，而真相是那個請求根本沒送到查詢。
 *
 * 列表本身不受影響：`ChangeLogEntrySchema.changeType` 是 `z.string()`，
 * 所以 makeup 的列**撈得回來也顯示得出來**，只是不能單獨篩。
 *
 * **等後端把 `makeup` 加進 `ChangeLogQuerySchema` 之後，把它從這裡拿掉。**
 */
const UNFILTERABLE_CHANGE_TYPES = new Set(['creation', 'makeup']);

@Component({
  selector: 'app-changes',
  imports: [
    CampusScopeNoteComponent,
    ChangeLogListComponent,
    RouterLink,
    PaginatorModule,
    SelectFieldComponent,
    PageOpenComponent,
  ],
  templateUrl: './changes.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangesComponent {
  readonly page = input.required<RouteObj>();

  private readonly sessionsService = inject(SessionsService);
  /** 分校跟頂欄走（#1138）：頁內分校下拉拿掉 */
  private readonly campusCtx = inject(CampusContextService);
  private readonly clock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly scheduleLink = RoutesCatalog.ADMIN_SESSIONS.absolutePath;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly entries = signal<ChangeLogEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);

  /** 開場標題用：這個月（不看類型／分校篩選）總共幾則、其中停課幾堂 */
  protected readonly monthTotal = signal<number | null>(null);
  protected readonly monthCancelled = signal<number | null>(null);

  protected readonly todayStr = this.clock.todayTaipei();
  private readonly today = this.todayStr;
  protected readonly month = signal(this.today.slice(0, 7));
  protected readonly changeType = signal<string | null>(null);
  private readonly campusId = this.campusCtx.id;
  /** 手機上「篩選」那一列展開與否；桌機永遠展開（wide:grid） */
  protected readonly filtersOpen = signal(false);

  protected readonly monthOptions = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const date = subMonths(parseISO(this.today), i);
    return { label: format(date, 'yyyy 年 M 月'), value: format(date, 'yyyy-MM') };
  });

  protected readonly changeTypeOptions = [
    { label: '全部異動', value: null as string | null },
    ...Object.entries(CHANGE_TYPE_LABELS)
      .filter(([value]) => !UNFILTERABLE_CHANGE_TYPES.has(value))
      .map(([value, label]) => ({ label, value: value as string | null })),
  ];

  protected readonly monthNumber = computed(() => Number(this.month().slice(5)));
  protected readonly filtered = computed(() => !!this.changeType());

  /** 手機上收進「篩選」那一列的摘要 */
  protected readonly filterSummary = computed(() => {
    const type = this.changeTypeOptions.find((o) => o.value === this.changeType())?.label;
    return type ?? '全部異動';
  });

  protected readonly pageSize = PAGE_SIZE;
  protected readonly first = computed(() => (this.currentPage() - 1) * PAGE_SIZE);

  constructor() {
    this.campusCtx.use();
    // 初次載入在下面；這裡只管之後頂欄換分校（開場的月總數不看分校，不用重查）
    toObservable(this.campusId)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.resetToFirstPage());

    this.load();
    this.loadMonthSummary();
  }

  protected onMonthChange(value: string): void {
    this.month.set(value);
    this.resetToFirstPage();
    this.loadMonthSummary();
  }

  protected onChangeTypeChange(value: string | null): void {
    this.changeType.set(value);
    this.resetToFirstPage();
  }

  protected resetFilters(): void {
    this.changeType.set(null);
    this.resetToFirstPage();
  }

  protected onPageChange(page: number): void {
    this.currentPage.set(page);
    this.load();
  }

  /** 換篩選條件後停在第 3 頁沒有意義 —— 結果集已經不同了。 */
  private resetToFirstPage(): void {
    this.currentPage.set(1);
    this.load();
  }

  private monthRange(): { from: string; to: string } {
    const base = parseISO(`${this.month()}-01`);
    return {
      from: format(startOfMonth(base), 'yyyy-MM-dd'),
      to: format(endOfMonth(base), 'yyyy-MM-dd'),
    };
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(false);

    this.sessionsService
      .listChanges({
        ...this.monthRange(),
        changeType: this.changeType() ?? undefined,
        campusId: this.campusId() ?? undefined,
        page: this.currentPage(),
        pageSize: PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.entries.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.entries.set([]);
          this.total.set(0);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  /**
   * 開場標題的兩個數字。只要 total，所以 pageSize 1。
   * 失敗就不顯示數字（標題退回頁名），不影響列表。
   */
  private loadMonthSummary(): void {
    this.monthTotal.set(null);
    this.monthCancelled.set(null);
    const range = this.monthRange();
    for (const [changeType, target] of [
      [undefined, this.monthTotal],
      ['cancellation', this.monthCancelled],
    ] as const) {
      this.sessionsService
        .listChanges({ ...range, changeType, page: 1, pageSize: 1 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (res) => target.set(res.meta.total), error: () => target.set(null) });
    }
  }
}
