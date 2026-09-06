import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { PaginatorModule } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';

import { CampusesService, type Campus } from '@core/campuses.service';
import {
  SessionsService,
  type ChangeLogEntry,
  type ScheduleChangeType,
} from '@core/sessions.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

const PAGE_SIZE = LIST_PAGE_SIZE;
const MONTHS_BACK = 12;

/**
 * `schedule_change_type` 的中文標籤。**這份表的完整性沒有任何東西在守** ——
 * enum 加了新值而這裡沒跟上時，表格會靠 `?? value` 顯示原始英文字（`makeup`），
 * 而**它不會拋錯、不會紅燈，列還是會出現**。
 *
 * `creation` 不是 enum 值，是後端合成的「建立課堂」那筆。
 */
const CHANGE_TYPE_LABELS: Record<ScheduleChangeType, string> = {
  reschedule: '調課',
  substitute: '代課',
  cancellation: '停課',
  uncancel: '恢復上課',
  time_change: '改時間',
  makeup: '補課',
  creation: '建立課堂',
};

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

import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
@Component({
  selector: 'app-changes',
  imports: [
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
    DataChipComponent,
    DatePipe,
    FormsModule,
    SelectModule,
    PaginatorModule,
  ],
  templateUrl: './changes.component.html',
  styleUrl: './changes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangesComponent {
  readonly page = input.required<RouteObj>();

  private readonly sessionsService = inject(SessionsService);
  private readonly campusesService = inject(CampusesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly entries = signal<ChangeLogEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);

  protected readonly month = signal(format(new Date(), 'yyyy-MM'));
  protected readonly changeType = signal<string | null>(null);
  protected readonly campusId = signal<string | null>(null);
  protected readonly campuses = signal<Campus[]>([]);

  protected readonly monthOptions = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const date = subMonths(new Date(), i);
    return { label: format(date, 'yyyy 年 M 月'), value: format(date, 'yyyy-MM') };
  });

  protected readonly changeTypeOptions = [
    { label: '全部異動', value: null as string | null },
    ...Object.entries(CHANGE_TYPE_LABELS)
      .filter(([value]) => !UNFILTERABLE_CHANGE_TYPES.has(value))
      .map(([value, label]) => ({ label, value: value as string | null })),
  ];

  protected readonly campusOptions = computed(() => [
    { label: '全部分校', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);

  protected readonly first = computed(() => (this.currentPage() - 1) * PAGE_SIZE);
  protected readonly pageSize = PAGE_SIZE;

  /** 分頁交給 app-responsive-table 內建的 paginator —— 表格與它的分頁不該被拆開 */
  protected readonly pagination = computed(() => ({
    first: this.first(),
    rows: PAGE_SIZE,
    totalRecords: this.total(),
  }));

  constructor() {
    this.campusesService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.campuses.set(res.data),
        error: () => this.campuses.set([]),
      });

    this.load();
  }

  /**
   * `?? value` 是最後的退路，不是設計 —— 它會顯示原始英文字（`makeup`）。
   * 現在 `CHANGE_TYPE_LABELS` 綁死 `ScheduleChangeType`，漏標籤會編不過，
   * 所以正常情況走不到那個 `??`；留著是因為後端的 `changeType` 回的是
   * `z.string()`，執行期仍可能出現型別沒涵蓋的值（型別是當下的保證，不是永久的）。
   */
  protected typeLabel(value: ScheduleChangeType): string {
    return CHANGE_TYPE_LABELS[value] ?? value;
  }

  protected onMonthChange(value: string): void {
    this.month.set(value);
    this.resetToFirstPage();
  }

  protected onChangeTypeChange(value: string | null): void {
    this.changeType.set(value);
    this.resetToFirstPage();
  }

  protected onCampusChange(value: string | null): void {
    this.campusId.set(value);
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

  private load(): void {
    const [year, month] = this.month().split('-').map(Number);
    const base = new Date(year, month - 1, 1);

    this.loading.set(true);
    this.loadError.set(false);

    this.sessionsService
      .listChanges({
        from: format(startOfMonth(base), 'yyyy-MM-dd'),
        to: format(endOfMonth(base), 'yyyy-MM-dd'),
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
}
