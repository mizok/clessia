import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { AuditLogsService, type AuditLog } from '@core/audit-logs.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';

interface ActionConfig {
  label: string;
  severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';
}

type LogTab = 'session' | 'attendance';

const ACTION_MAP: Record<string, ActionConfig> = {
  create: { label: '新增', severity: 'success' },
  update: { label: '編輯', severity: 'info' },
  delete: { label: '刪除', severity: 'danger' },
  batch_update_attendance: { label: '批次點名', severity: 'info' },
  sync_leave_to_attendance: { label: '套用請假', severity: 'warn' },
  revert_leave_attendance: { label: '恢復出勤', severity: 'success' },
  truncate_leave: { label: '取消剩餘假期', severity: 'warn' },
  batch_assign_teacher: { label: '批次指派老師', severity: 'info' },
  batch_update_session_time: { label: '批次調整時間', severity: 'info' },
  batch_cancel_session: { label: '批次停課', severity: 'warn' },
  batch_uncancel_session: { label: '批次恢復課堂', severity: 'success' },
  cancel_session: { label: '停課', severity: 'warn' },
  substitute_teacher: { label: '代課', severity: 'info' },
  reschedule_session: { label: '調課', severity: 'info' },
};

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  session: '課堂',
  attendance: '出勤',
};

@Component({
  selector: 'app-session-operations-log-dialog',
  standalone: true,
  imports: [
    CommonModule,
    TabsModule,
    TagModule,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  templateUrl: './session-operations-log-dialog.component.html',
  styleUrl: './session-operations-log-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionOperationsLogDialogComponent {
  private readonly auditLogsService = inject(AuditLogsService);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly selectedTab = signal<LogTab>('session');
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

  constructor() {
    this.loadPage();
  }

  protected onTabChange(value: string | number | undefined): void {
    const nextTab: LogTab = value === 'attendance' ? 'attendance' : 'session';
    if (nextTab === this.selectedTab()) {
      return;
    }

    this.selectedTab.set(nextTab);
    this.page.set(1);
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

  protected getActionConfig(action: string): ActionConfig {
    return ACTION_MAP[action] ?? { label: action, severity: 'secondary' };
  }

  protected getResourceTypeLabel(type: string): string {
    return RESOURCE_TYPE_LABEL[type] ?? type;
  }

  protected getDetailsSummary(log: AuditLog): string {
    const details = log.details;
    if (!details || Object.keys(details).length === 0) return '';
    if (typeof details['updatedCount'] === 'number') {
      const presentCount = typeof details['presentCount'] === 'number' ? details['presentCount'] : 0;
      const absentCount = typeof details['absentCount'] === 'number' ? details['absentCount'] : 0;
      return `更新 ${details['updatedCount']} 筆（出席 ${presentCount} / 缺席 ${absentCount}）`;
    }
    if (typeof details['affectedEventCount'] === 'number') {
      return `影響 ${details['affectedEventCount']} 堂課`;
    }
    if (typeof details['studentName'] === 'string' && typeof details['status'] === 'string') {
      return `${details['studentName']} → ${this.getAttendanceStatusLabel(details['status'])}`;
    }
    return '';
  }

  protected close(): void {
    this.ref.close();
  }

  private loadPage(): void {
    this.loading.set(true);
    this.auditLogsService
      .list({
        resourceTypes: [this.selectedTab()],
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
          this.logs.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  private getAttendanceStatusLabel(status: string): string {
    if (status === 'present') return '出席';
    if (status === 'absent') return '缺席';
    if (status === 'on_leave') return '請假';
    return status;
  }
}
