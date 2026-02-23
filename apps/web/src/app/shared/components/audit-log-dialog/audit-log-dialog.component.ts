import { Component, inject, input, model, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';

// PrimeNG
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';

// Services
import { AuditLogsService, type AuditLog } from '@core/audit-logs.service';

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
  imports: [CommonModule, DialogModule, TableModule, TagModule, ButtonModule],
  templateUrl: './audit-log-dialog.component.html',
  styleUrl: './audit-log-dialog.component.scss',
})
export class AuditLogDialogComponent {
  readonly resourceTypes = input.required<string[]>();
  readonly title = input<string>('操作紀錄');
  readonly visible = model(false);

  private readonly auditLogsService = inject(AuditLogsService);

  protected readonly logs = signal<AuditLog[]>([]);
  protected readonly loading = signal(false);
  protected readonly page = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly total = signal(0);

  protected readonly isFirstPage = computed(() => this.page() <= 1);
  protected readonly isLastPage = computed(() => this.page() >= this.totalPages());

  protected getActionConfig(action: string): ActionConfig {
    return ACTION_MAP[action] ?? { label: action, severity: 'secondary' };
  }

  protected getResourceTypeLabel(type: string): string {
    return RESOURCE_TYPE_LABEL[type] ?? type;
  }

  protected onShow(): void {
    this.page.set(1);
    this.loadPage();
  }

  protected prevPage(): void {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
      this.loadPage();
    }
  }

  protected nextPage(): void {
    if (this.page() < this.totalPages()) {
      this.page.update((p) => p + 1);
      this.loadPage();
    }
  }

  private loadPage(): void {
    this.loading.set(true);
    this.auditLogsService
      .list({
        resourceTypes: this.resourceTypes(),
        page: this.page(),
        pageSize: 30,
      })
      .subscribe({
        next: (res) => {
          this.logs.set(res.data);
          this.total.set(res.meta.total);
          this.totalPages.set(res.meta.totalPages);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }
}
