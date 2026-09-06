import { Component, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService, ConfirmEventType } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { format, differenceInCalendarDays } from 'date-fns';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { LeaveFormDialogComponent } from './leave-form-dialog.component';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';

@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [
    PageActionsComponent,
    DataChipComponent,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
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
  /** 主要行動。**寫成 readonly property 不是模板裡的物件字面量** ——
   *  字面量每輪變更偵測都會產生新物件，讓 signal input 每次都判定為「變了」。 */
  protected readonly primaryAction: PageAction = { label: '新增請假', icon: 'pi pi-plus' };

  readonly page = input.required<RouteObj>();

  private readonly leaveService = inject(LeaveService);
  private readonly refData = inject(ReferenceDataService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);

  protected readonly loading = signal(false);
  protected readonly records = signal<LeaveRequest[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = LIST_PAGE_SIZE;

  protected filterCampusId: string | null = null;
  protected filterDateRange: Date[] | null = null;

  protected readonly campuses = computed(() => [
    { label: '全部分校', value: '' },
    ...this.refData
      .campuses()
      .filter((campus) => campus.isActive)
      .map((campus) => ({ label: campus.name, value: campus.id })),
  ]);

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.totalRecords(),
  }));

  protected calcDays(startDate: string, endDate: string): number {
    return differenceInCalendarDays(new Date(endDate), new Date(startDate)) + 1;
  }

  protected leaveState(record: LeaveRequest): 'future' | 'active' | 'past' {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (record.startDate > today) return 'future';
    if (record.endDate >= today) return 'active';
    return 'past';
  }

  protected submittedByRoleLabel(role: 'parent' | 'admin'): string {
    return role === 'parent' ? '家長' : '管理員';
  }

  ngOnInit(): void {
    this.loadCampuses();
    this.loadRecords();
  }

  private loadCampuses(): void {
    this.refData.loadCampuses();
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

  protected openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        resourceTypes: ['leave'],
      },
    });
  }

  protected confirmDelete(record: LeaveRequest): void {
    const state = this.leaveState(record);

    if (state === 'active') {
      this.confirmActiveDelete(record);
    } else if (state === 'past') {
      this.confirmPastDelete(record);
    } else {
      this.confirmFutureDelete(record);
    }
  }

  private confirmFutureDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      message: `確定要取消 ${record.studentName} 的請假申請（${record.startDate} ~ ${record.endDate}）？`,
      header: '取消請假申請',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '確認取消',
      rejectLabel: '返回',
      accept: () =>
        this.executeDelete(record, 'full', '已取消請假', `${record.studentName} 的請假申請已取消`),
    });
  }

  private confirmPastDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      message:
        `注意：此請假紀錄已結束（${record.startDate} ~ ${record.endDate}）。\n` +
        `刪除後將同步恢復對應課堂的出勤狀態，此操作無法復原。\n\n` +
        `確定要刪除這筆歷史紀錄嗎？`,
      header: '刪除歷史請假紀錄',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '確認刪除',
      rejectLabel: '返回',
      accept: () =>
        this.executeDelete(record, 'full', '已刪除', `${record.studentName} 的歷史請假紀錄已刪除`),
    });
  }

  private confirmActiveDelete(record: LeaveRequest): void {
    const today = format(new Date(), 'yyyy-MM-dd');
    const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');

    this.confirmationService.confirm({
      message:
        `此假期目前進行中（${record.startDate} ~ ${record.endDate}）。\n` + `請選擇操作方式：`,
      header: '取消進行中假期',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '取消剩餘假期',
      rejectLabel: '完全刪除',
      accept: () =>
        this.executeDelete(
          record,
          'truncate',
          '已取消剩餘假期',
          `已保留至 ${yesterday} 的請假，${today} 起恢復出勤`,
        ),
      reject: (type?: ConfirmEventType) => {
        if (type === ConfirmEventType.REJECT) {
          setTimeout(() => this.confirmFullActiveDelete(record));
        }
      },
    });
  }

  private confirmFullActiveDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      message:
        `確定要完全刪除 ${record.studentName} 的請假紀錄（${record.startDate} ~ ${record.endDate}）？\n` +
        `包含已過去的請假天數也將一併撤銷，此操作無法復原。`,
      header: '完全刪除請假紀錄',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '確認完全刪除',
      rejectLabel: '返回',
      accept: () =>
        this.executeDelete(
          record,
          'full',
          '已刪除請假紀錄',
          `${record.studentName} 的請假紀錄已完全刪除`,
        ),
    });
  }

  private executeDelete(
    record: LeaveRequest,
    mode: 'truncate' | 'full',
    summary: string,
    detail: string,
  ): void {
    this.leaveService.delete(record.id, mode).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary, detail });
        this.loadRecords();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '操作失敗，請稍後再試',
        });
      },
    });
  }
}
