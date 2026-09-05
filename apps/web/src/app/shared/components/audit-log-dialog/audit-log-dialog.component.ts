import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { AuditLogsService, type AuditLog } from '@core/audit-logs.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';

interface ActionConfig {
  label: string;
}

const ACTION_MAP: Record<string, ActionConfig> = {
  create: { label: '新增' },
  update: { label: '編輯' },
  delete: { label: '刪除' },
  batch_update_attendance: { label: '批次點名' },
  sync_leave_to_attendance: { label: '套用請假' },
  revert_leave_attendance: { label: '恢復出勤' },
  truncate_leave: { label: '取消剩餘假期' },
  archive: { label: '封存' },
  deactivate: { label: '停用' },
  activate: { label: '啟用' },
  toggle_active: { label: '切換狀態' },
  batch_activate: { label: '批次啟用' },
  batch_deactivate: { label: '批次停用' },
  batch_delete: { label: '批次刪除' },
  batch_assign_teacher: { label: '批次指派老師' },
  batch_update_session_time: { label: '批次調整時間' },
  batch_cancel_session: { label: '批次停課' },
  batch_uncancel_session: { label: '批次恢復課堂' },
  generate_sessions: { label: '建立課堂' },
  add_schedule: { label: '新增時段' },
  update_schedule: { label: '編輯時段' },
  delete_schedule: { label: '刪除時段' },
  cancel_session: { label: '停課' },
  substitute_teacher: { label: '代課' },
  reschedule_session: { label: '調課' },
  add_item: { label: '新增項目' },
  remove_item: { label: '移除項目' },
  payment: { label: '收款' },
  refund: { label: '退款' },
};

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  class: '班級',
  session: '課堂',
  course: '課程',
  campus: '分校',
  staff: '人員',
  attendance: '出勤',
  leave: '請假',
  invoice: '帳單',
  payment_record: '收款紀錄',
  fee_template: '費用方案',
};

@Component({
  selector: 'app-audit-log-dialog',
  standalone: true,
  imports: [
    DataChipComponent,
    CommonModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  templateUrl: './audit-log-dialog.component.html',
  styleUrl: './audit-log-dialog.component.scss',
})
export class AuditLogDialogComponent {
  private readonly auditLogsService = inject(AuditLogsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly resourceTypes = signal<string[]>(this.config.data?.resourceTypes ?? []);

  protected readonly logs = signal<AuditLog[]>([]);
  protected readonly loading = signal(false);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly total = signal(0);
  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.page() - 1) * this.pageSize(), 0),
    rows: this.pageSize(),
    totalRecords: this.total(),
    showCurrentPageReport: true,
    currentPageReportTemplate: '顯示 {first} - {last}，共 {totalRecords} 筆',
    alwaysShow: false,
  }));

  protected getActionConfig(action: string): ActionConfig {
    return ACTION_MAP[action] ?? { label: action };
  }

  protected getResourceTypeLabel(type: string): string {
    return RESOURCE_TYPE_LABEL[type] ?? type;
  }

  protected getDetailsSummary(log: AuditLog): string {
    const d = log.details;
    if (!d || Object.keys(d).length === 0) return '';
    if (typeof d['unassignedSessions'] === 'number' && d['unassignedSessions'] > 0) {
      return `解除 ${d['unassignedSessions']} 堂課堂指派`;
    }
    if (typeof d['updatedCount'] === 'number') {
      const presentCount = typeof d['presentCount'] === 'number' ? d['presentCount'] : 0;
      const absentCount = typeof d['absentCount'] === 'number' ? d['absentCount'] : 0;
      return `更新 ${d['updatedCount']} 筆（出席 ${presentCount} / 缺席 ${absentCount}）`;
    }
    if (typeof d['affectedEventCount'] === 'number') {
      return `影響 ${d['affectedEventCount']} 堂課`;
    }
    if (typeof d['studentName'] === 'string' && typeof d['status'] === 'string') {
      return `${d['studentName']} → ${this.getAttendanceStatusLabel(d['status'])}`;
    }
    return '';
  }

  private getAttendanceStatusLabel(status: string): string {
    if (status === 'present') return '出席';
    if (status === 'absent') return '缺席';
    if (status === 'on_leave') return '請假';
    return status;
  }

  protected cancel(): void {
    this.ref.close();
  }

  constructor() {
    this.loadPage();
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    const nextRows = Math.max(event.rows, 1);
    const nextFirst = Math.max(event.first, 0);
    const nextPage = Math.floor(nextFirst / nextRows) + 1;

    this.pageSize.set(nextRows);
    this.page.set(nextPage);
    this.loadPage();
  }

  private loadPage(): void {
    this.loading.set(true);
    this.auditLogsService
      .list({
        resourceTypes: this.resourceTypes(),
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (res) => {
          this.logs.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }
}
