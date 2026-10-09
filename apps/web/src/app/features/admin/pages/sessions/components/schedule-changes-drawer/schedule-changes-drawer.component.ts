import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { Subscription } from 'rxjs';

import { CampusContextService } from '@core/campus-context.service';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { SystemClockService } from '@core/system-clock.service';
import { ChangeLogListComponent } from '@shared/components/change-log-list/change-log-list.component';
import { CHANGE_TYPE_LABELS } from '@shared/components/change-log-list/change-log.util';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';

/** 抽屜一次拿一頁到底（API 上限 100）；超過的請到「全部異動」頁翻頁 */
const DRAWER_PAGE_SIZE = 100;
const MONTHS_BACK = 12;

/** 跟 `/admin/changes` 的篩選同一組：`creation`（合成）與 `makeup`（後端還不收）篩不到 */
const UNFILTERABLE = new Set(['creation', 'makeup']);

/**
 * 課表的「全部異動」抽屜（A6 `#changes`，#1314 S3）：純 hash `#changes` 開、桌機右側抽屜、
 * 手機全螢幕。內容與 `/admin/changes` 是同一份（`app-change-log-list`），這裡只管取數與篩選。
 *
 * 原生 `<dialog>` + `showModal()`：Esc、焦點圈住、背景 inert 由瀏覽器給（跟「快速選取」面板同一個做法）。
 * 開關由課表頁的 `open` 驅動（它讀網址的 fragment），關閉一律回報 `closed` 讓頁面把 hash 拿掉。
 *
 * ponytail: 「老師或班級」搜尋要等後端 `q`（#1412），篩選列留在月份旁，API 到了再加一個欄位。
 */
@Component({
  selector: 'app-schedule-changes-drawer',
  imports: [ChangeLogListComponent, RouterLink, SelectFieldComponent],
  templateUrl: './schedule-changes-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleChangesDrawerComponent {
  readonly open = input(false);
  readonly closed = output<void>();

  private readonly sessionsService = inject(SessionsService);
  private readonly campusCtx = inject(CampusContextService);
  private readonly clock = inject(SystemClockService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly adminChangesLink = RoutesCatalog.ADMIN_CHANGES.absolutePath;
  protected readonly today = this.clock.todayTaipei();

  protected readonly month = signal(this.today.slice(0, 7));
  protected readonly changeType = signal<string | null>(null);
  protected readonly entries = signal<ChangeLogEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly loadError = signal(false);

  protected readonly monthOptions = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const date = subMonths(parseISO(this.today), i);
    return { label: format(date, 'yyyy 年 M 月'), value: format(date, 'yyyy-MM') };
  });
  protected readonly changeTypeOptions = [
    { label: '全部異動', value: null as string | null },
    ...Object.entries(CHANGE_TYPE_LABELS)
      .filter(([value]) => !UNFILTERABLE.has(value))
      .map(([value, label]) => ({ label, value: value as string | null })),
  ];

  protected readonly pageSize = DRAWER_PAGE_SIZE;
  private inFlight: Subscription | null = null;

  constructor() {
    effect(() => {
      const d = this.dialog().nativeElement;
      if (this.open() && !d.open) {
        d.showModal();
        this.load();
      }
      if (!this.open() && d.open) d.close();
    });
  }

  protected onMonthChange(value: string | null): void {
    if (!value) return;
    this.month.set(value);
    this.load();
  }

  protected onTypeChange(value: string | null): void {
    this.changeType.set(value);
    this.load();
  }

  /** 點背景＝關閉（內容蓋滿整個 dialog，點得到 dialog 本身只會是背景） */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  private load(): void {
    this.inFlight?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(false);
    const base = parseISO(`${this.month()}-01`);
    this.inFlight = this.sessionsService
      .listChanges({
        from: format(startOfMonth(base), 'yyyy-MM-dd'),
        to: format(endOfMonth(base), 'yyyy-MM-dd'),
        changeType: this.changeType() ?? undefined,
        campusId: this.campusCtx.id() ?? undefined,
        page: 1,
        pageSize: DRAWER_PAGE_SIZE,
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
