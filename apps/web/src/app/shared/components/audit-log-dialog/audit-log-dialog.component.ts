import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagModule } from 'primeng/tag';
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

interface ActionConfig {
  label: string;
  severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';
}

const ACTION_MAP: Record<string, ActionConfig> = {
  create: { label: '新增', severity: 'success' },
  update: { label: '編輯', severity: 'info' },
  delete: { label: '刪除', severity: 'danger' },
  toggle_active: { label: '切換狀態', severity: 'secondary' },
  batch_activate: { label: '批次啟用', severity: 'success' },
  batch_deactivate: { label: '批次停用', severity: 'secondary' },
  batch_delete: { label: '批次刪除', severity: 'danger' },
  add_schedule: { label: '新增時段', severity: 'success' },
  update_schedule: { label: '編輯時段', severity: 'info' },
  delete_schedule: { label: '刪除時段', severity: 'danger' },
};

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  class: '班級',
  course: '課程',
  campus: '分校',
  staff: '人員',
};

@Component({
  selector: 'app-audit-log-dialog',
  standalone: true,
  imports: [
    CommonModule,
    TagModule,
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
    return ACTION_MAP[action] ?? { label: action, severity: 'secondary' };
  }

  protected getResourceTypeLabel(type: string): string {
    return RESOURCE_TYPE_LABEL[type] ?? type;
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
