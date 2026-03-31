import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { format } from 'date-fns';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  AttendanceService,
  type AttendanceRecord,
  type AttendanceStatus,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_SEVERITIES,
} from '@core/attendance.service';
import { CampusesService } from '@core/campuses.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TagModule,
    ToastModule,
    TooltipModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);

  protected readonly loading = signal(false);
  protected readonly records = signal<AttendanceRecord[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = 20;

  protected filterCampusId: string | null = null;
  protected filterDateRange: Date[] | null = null;
  protected filterStatus: AttendanceStatus | null = null;

  protected readonly campuses = signal<{ label: string; value: string }[]>([]);

  protected readonly statusOptions = [
    { label: '全部狀態', value: null },
    { label: '到課', value: 'present' as AttendanceStatus },
    { label: '缺席', value: 'absent' as AttendanceStatus },
    { label: '請假', value: 'on_leave' as AttendanceStatus },
  ];

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.totalRecords(),
  }));

  protected readonly ATTENDANCE_STATUS_LABELS = ATTENDANCE_STATUS_LABELS;
  protected readonly ATTENDANCE_STATUS_SEVERITIES = ATTENDANCE_STATUS_SEVERITIES;

  protected readonly statusEditOptions = [
    { label: '到課', value: 'present' as AttendanceStatus },
    { label: '缺席', value: 'absent' as AttendanceStatus },
    { label: '請假', value: 'on_leave' as AttendanceStatus },
  ];

  ngOnInit(): void {
    this.loadCampuses();
    this.loadRecords();
  }

  private loadCampuses(): void {
    this.campusesService.list({ isActive: true }).subscribe({
      next: (res) => {
        this.campuses.set([
          { label: '全部分校', value: '' },
          ...res.data.map((c) => ({ label: c.name, value: c.id })),
        ]);
      },
    });
  }

  protected loadRecords(): void {
    this.loading.set(true);
    this.attendanceService
      .list({
        campusId: this.filterCampusId ?? undefined,
        status: this.filterStatus ?? undefined,
        dateFrom:
          this.filterDateRange?.[0] ? format(this.filterDateRange[0], 'yyyy-MM-dd') : undefined,
        dateTo:
          this.filterDateRange?.[1] ? format(this.filterDateRange[1], 'yyyy-MM-dd') : undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.records.set(res.data);
          this.totalRecords.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '錯誤', detail: '無法載入出勤紀錄' });
          this.loading.set(false);
        },
      });
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.loadRecords();
  }

  protected onFilterChange(): void {
    this.currentPage.set(1);
    this.loadRecords();
  }

  protected updateStatus(record: AttendanceRecord, newStatus: AttendanceStatus): void {
    this.attendanceService.update(record.id, { status: newStatus }).subscribe({
      next: (updated) => {
        this.records.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
        this.messageService.add({ severity: 'success', summary: '已更新', detail: '出勤狀態已修改' });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '錯誤', detail: '更新失敗，請稍後再試' });
      },
    });
  }
}
