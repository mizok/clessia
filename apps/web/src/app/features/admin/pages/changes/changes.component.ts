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
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { addDays, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { PaginatorModule } from 'primeng/paginator';

import { CampusContextService } from '@core/campus-context.service';
import {
  SessionsService,
  type ChangeLogEntry,
  type ScheduleChangeType,
} from '@core/sessions.service';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SystemClockService } from '@core/system-clock.service';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

const PAGE_SIZE = LIST_PAGE_SIZE;
const MONTHS_BACK = 12;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

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

/** 類型小標的圖示（A6 沿用課表「全部異動」的那一組） */
const CHANGE_TYPE_ICONS: Record<ScheduleChangeType, string> = {
  reschedule: 'pi-arrow-right',
  substitute: 'pi-arrow-right-arrow-left',
  cancellation: 'pi-times',
  uncancel: 'pi-replay',
  time_change: 'pi-clock',
  makeup: 'pi-link',
  creation: 'pi-plus',
};

/** 一則：單筆異動，或同一次批次操作產生的多筆 */
interface ChangeItem {
  key: string;
  rows: ChangeLogEntry[];
}

/** 一章：同一個上課日 */
interface ChangeChapter {
  date: string;
  items: ChangeItem[];
  count: number;
}

/**
 * **API 只有 `isBatch`、沒有批次 id**（#991 P1，計畫席同意的暫定做法）：同一次批次操作寫入的列，
 * 類型、原因、操作者、建立時間（到秒）都相同，用它們當分組鍵。只在同一頁的資料內分組 ——
 * 一個批次跨了分頁的話，兩頁各收成一則。後端給批次 id 之後換成它。
 */
function batchKey(e: ChangeLogEntry): string {
  return [e.changeType, e.reason, e.createdByName, e.createdAt.slice(0, 19)].join('|');
}

@Component({
  selector: 'app-changes',
  imports: [
    DatePipe,
    NgTemplateOutlet,
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

  private readonly today = this.clock.todayTaipei();
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

  /**
   * 依上課日分章（A6）：今天以後的在前、由近到遠；過去的在後、由近到遠。
   * 章內同一次批次收成一則。
   */
  protected readonly chapters = computed<ChangeChapter[]>(() => {
    const today = this.today;
    const dateOf = (e: ChangeLogEntry) => e.sessionDate ?? '';
    const sorted = [...this.entries()].sort((a, b) => {
      const fa = dateOf(a) >= today;
      const fb = dateOf(b) >= today;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? dateOf(a).localeCompare(dateOf(b)) : dateOf(b).localeCompare(dateOf(a));
    });
    const chapters = new Map<string, ChangeChapter>();
    for (const e of sorted) {
      const date = dateOf(e);
      let chapter = chapters.get(date);
      if (!chapter) chapters.set(date, (chapter = { date, items: [], count: 0 }));
      chapter.count++;
      const key = e.isBatch ? batchKey(e) : e.id;
      const item = chapter.items.find((i) => i.key === key);
      if (item) item.rows.push(e);
      else chapter.items.push({ key, rows: [e] });
    }
    return [...chapters.values()];
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

  /**
   * `?? value` 是最後的退路，不是設計 —— 它會顯示原始英文字（`makeup`）。
   * 現在 `CHANGE_TYPE_LABELS` 綁死 `ScheduleChangeType`，漏標籤會編不過，
   * 所以正常情況走不到那個 `??`；留著是因為後端的 `changeType` 回的是
   * `z.string()`，執行期仍可能出現型別沒涵蓋的值（型別是當下的保證，不是永久的）。
   */
  protected typeLabel(value: ScheduleChangeType): string {
    return CHANGE_TYPE_LABELS[value] ?? value;
  }

  protected typeIcon(value: ScheduleChangeType): string {
    return CHANGE_TYPE_ICONS[value] ?? 'pi-circle';
  }

  /** 章的大字：今天／明天／M/D；沒有上課日（理論上不會有）寫「未排日期」 */
  protected dayLabel(date: string): string {
    if (!date) return '未排日期';
    if (date === this.today) return '今天';
    if (date === format(addDays(parseISO(this.today), 1), 'yyyy-MM-dd')) return '明天';
    return format(parseISO(date), 'M/d');
  }

  /** 章的小字：今天／明天要補上日期，其他只寫星期 */
  protected dayMeta(date: string): string {
    if (!date) return '';
    const d = parseISO(date);
    const weekday = `週${WEEKDAYS[d.getDay()]}`;
    return this.dayLabel(date).includes('/') ? weekday : `${format(d, 'M/d')} ${weekday}`;
  }

  protected classCount(rows: ChangeLogEntry[]): number {
    return new Set(rows.map((r) => r.className)).size;
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
