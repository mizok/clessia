import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { format, differenceInCalendarDays } from 'date-fns';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { CampusesService } from '@core/campuses.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { LeaveFormDialogComponent } from './leave-form-dialog.component';

@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TagModule,
    ToastModule,
    TooltipModule,
    ConfirmDialogModule,
    DynamicDialogModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, ConfirmationService, DialogService],
  templateUrl: './leave.page.html',
  styleUrl: './leave.page.scss',
})
export class LeavePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly leaveService = inject(LeaveService);
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);

  protected readonly loading = signal(false);
  protected readonly records = signal<LeaveRequest[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = 20;

  protected filterCampusId: string | null = null;
  protected filterDateRange: Date[] | null = null;

  protected readonly campuses = signal<{ label: string; value: string }[]>([]);

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.totalRecords(),
  }));

  protected calcDays(startDate: string, endDate: string): number {
    return differenceInCalendarDays(new Date(endDate), new Date(startDate)) + 1;
  }

  protected submittedByRoleLabel(role: 'parent' | 'admin'): string {
    return role === 'parent' ? '家長' : '管理員';
  }

  protected submittedByRoleSeverity(
    role: 'parent' | 'admin',
  ): 'info' | 'secondary' {
    return role === 'parent' ? 'info' : 'secondary';
  }

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
    this.leaveService
      .list({
        campusId: this.filterCampusId ?? undefined,
        dateFrom: this.filterDateRange?.[0]
          ? format(this.filterDateRange[0], 'yyyy-MM-dd')
          : undefined,
        dateTo: this.filterDateRange?.[1]
          ? format(this.filterDateRange[1], 'yyyy-MM-dd')
          : undefined,
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
          this.messageService.add({
            severity: 'error',
            summary: '錯誤',
            detail: '無法載入請假紀錄',
          });
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

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(LeaveFormDialogComponent, {
      header: '新增請假',
      width: '480px',
      modal: true,
    });

    if (!ref) return;

    ref.onClose.subscribe((leave: LeaveRequest | null) => {
      if (leave) {
        this.messageService.add({
          severity: 'success',
          summary: '已新增',
          detail: `${leave.studentName} 的請假申請已送出`,
        });
        this.currentPage.set(1);
        this.loadRecords();
      }
    });
  }

  protected confirmDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      message: `確定要刪除 ${record.studentName} 的請假紀錄（${record.startDate} ~ ${record.endDate}）？`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      accept: () => {
        this.leaveService.delete(record.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: '已刪除',
              detail: '請假紀錄已刪除',
            });
            this.loadRecords();
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: '錯誤',
              detail: '刪除失敗，請稍後再試',
            });
          },
        });
      },
    });
  }
}
