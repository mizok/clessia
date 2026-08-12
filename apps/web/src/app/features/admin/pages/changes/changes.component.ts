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
import { TagModule } from 'primeng/tag';

import { CampusesService, type Campus } from '@core/campuses.service';
import { SessionsService, type ChangeLogEntry } from '@core/sessions.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';

const PAGE_SIZE = 20;
const MONTHS_BACK = 12;

const CHANGE_TYPE_LABELS: Record<string, string> = {
  reschedule: '調課',
  substitute: '代課',
  cancellation: '停課',
  uncancel: '恢復上課',
  time_change: '改時間',
  creation: '建立課堂',
};

@Component({
  selector: 'app-changes',
  imports: [DatePipe, FormsModule, SelectModule, TagModule, PaginatorModule],
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
      .filter(([value]) => value !== 'creation')
      .map(([value, label]) => ({ label, value: value as string | null })),
  ];

  protected readonly campusOptions = computed(() => [
    { label: '全部分校', value: null as string | null },
    ...this.campuses().map((c) => ({ label: c.name, value: c.id as string | null })),
  ]);

  protected readonly first = computed(() => (this.currentPage() - 1) * PAGE_SIZE);
  protected readonly pageSize = PAGE_SIZE;

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

  protected typeLabel(value: string): string {
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
