import { DatePipe } from '@angular/common';
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
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { PaginatorModule } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';

import { CampusesService, type Campus } from '@core/campuses.service';
import {
  ENROLLMENT_STATUS_LABELS,
  EnrollmentsService,
  type Enrollment,
  type EnrollmentStatus,
} from '@core/enrollments.service';
import { RouteObj } from '@core/smart-enums/routes-catalog';

import { EVENT_LABELS, toEnrollmentEvent, type EnrollmentEvent } from './enrollment-event.util';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';

const PAGE_SIZE = 20;
const MONTHS_BACK = 12;

/** 期間選項的「全部」—— 清空期間就退化成全部在籍的瀏覽 */
const ALL_MONTHS = '';

interface EnrollmentRow {
  readonly enrollment: Enrollment;
  readonly event: EnrollmentEvent;
}

@Component({
  selector: 'app-enrollments',
  imports: [DataChipComponent, DatePipe, FormsModule, SelectModule, TagModule, PaginatorModule],
  templateUrl: './enrollments.page.html',
  styleUrl: './enrollments.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollmentsPage {
  readonly page = input.required<RouteObj>();

  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly campusesService = inject(CampusesService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly EVENT_LABELS = EVENT_LABELS;
  protected readonly STATUS_LABELS = ENROLLMENT_STATUS_LABELS;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);

  protected readonly month = signal(format(new Date(), 'yyyy-MM'));
  protected readonly status = signal<EnrollmentStatus | null>(null);
  protected readonly campusId = signal<string | null>(null);
  protected readonly campuses = signal<Campus[]>([]);

  protected readonly monthOptions = [
    ...Array.from({ length: MONTHS_BACK }, (_, i) => {
      const date = subMonths(new Date(), i);
      return { label: format(date, 'yyyy 年 M 月'), value: format(date, 'yyyy-MM') };
    }),
    { label: '不限期間', value: ALL_MONTHS },
  ];

  /**
   * 刻意不放「待付款」：目前沒有任何流程會產生 pending_payment（invoices 表還不存在），
   * 放一個永遠是空的篩選只會讓人以為系統壞了。M3 做金流時再加。
   */
  protected readonly statusOptions = [
    { label: '全部狀態', value: null as EnrollmentStatus | null },
    ...(['active', 'suspended', 'withdrawal', 'void'] as const).map((value) => ({
      label: ENROLLMENT_STATUS_LABELS[value],
      value: value as EnrollmentStatus | null,
    })),
  ];

  protected readonly campusOptions = computed(() => [
    { label: '全部分校', value: null as string | null },
    ...this.campuses().map((campus) => ({ label: campus.name, value: campus.id as string | null })),
  ]);

  protected readonly rows = computed<EnrollmentRow[]>(() =>
    this.enrollments().map((enrollment) => ({ enrollment, event: toEnrollmentEvent(enrollment) })),
  );

  protected readonly joinedCount = computed(
    () => this.rows().filter((row) => row.event.kind === 'joined').length,
  );
  protected readonly leftCount = computed(
    () => this.rows().filter((row) => row.event.kind === 'left').length,
  );

  protected readonly first = computed(() => (this.currentPage() - 1) * PAGE_SIZE);
  protected readonly hasPeriod = computed(() => this.month() !== ALL_MONTHS);

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

  protected onMonthChange(value: string): void {
    this.month.set(value);
    this.resetToFirstPage();
  }

  protected onStatusChange(value: EnrollmentStatus | null): void {
    this.status.set(value);
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

  /** 換篩選條件後停在第 3 頁沒有意義 —— 結果集已經不同了 */
  private resetToFirstPage(): void {
    this.currentPage.set(1);
    this.load();
  }

  /** 狀態變更的唯一入口是班級詳情頁，這裡只負責把人送過去 */
  protected openClass(row: EnrollmentRow): void {
    this.router.navigate([
      '/admin/courses',
      row.enrollment.courseId,
      'classes',
      row.enrollment.classId,
    ]);
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(false);

    this.enrollmentsService
      .list({
        ...this.periodParams(),
        status: this.status() ?? undefined,
        campusId: this.campusId() ?? undefined,
        // 新報名的 updatedAt 是建立時間、退班的是退班時間 —— 兩種列的最後異動剛好等於事件日
        sort: 'updatedAt',
        page: this.currentPage(),
        pageSize: PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.enrollments.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.enrollments.set([]);
          this.total.set(0);
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  private periodParams(): { from?: string; to?: string } {
    if (!this.hasPeriod()) return {};

    const [year, month] = this.month().split('-').map(Number);
    const base = new Date(year, month - 1, 1);

    return {
      from: format(startOfMonth(base), 'yyyy-MM-dd'),
      to: format(endOfMonth(base), 'yyyy-MM-dd'),
    };
  }
}
