import { Component, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { TabsModule } from 'primeng/tabs';
import { AuditLogsService, type AuditLog } from '@core/audit-logs.service';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

/** 彈窗裡的分頁（課表：課堂異動／出勤紀錄）。不給就是單一清單，照 `resourceTypes` 查 */
export interface AuditLogTab {
  readonly label: string;
  readonly resourceTypes: readonly string[];
  /** 這個分頁沒有紀錄時的字，不給就是「尚無操作紀錄」 */
  readonly emptyText?: string;
}

/** 開彈窗時的 `data`（#2006：全站操作紀錄只用這一支，課表那支併進來） */
export interface AuditLogDialogData {
  readonly resourceTypes?: readonly string[];
  readonly tabs?: readonly AuditLogTab[];
}

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
  split_schedule: { label: '從某日起改時段' },
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
    SkeletonComponent,
    DataChipComponent,
    DatePipe,
    PaginatorModule,
    TabsModule,
    LoadFailedComponent,
  ],
  templateUrl: './audit-log-dialog.component.html',
})
export class AuditLogDialogComponent {
  private readonly auditLogsService = inject(AuditLogsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  private readonly data = (this.config.data ?? {}) as AuditLogDialogData;
  protected readonly tabs = signal<readonly AuditLogTab[]>(this.data.tabs ?? []);
  protected readonly tabIndex = signal(0);
  private readonly resourceTypes = computed(
    () => this.tabs()[this.tabIndex()]?.resourceTypes ?? this.data.resourceTypes ?? [],
  );
  protected readonly emptyText = computed(
    () => this.tabs()[this.tabIndex()]?.emptyText ?? '尚無操作紀錄',
  );

  protected readonly logs = signal<AuditLog[]>([]);
  protected readonly loading = signal(false);
  /** 取數失敗。**不能沿用 `logs().length === 0`** —— 「尚無操作紀錄」在失敗時是謊話（#812） */
  protected readonly loadFailed = signal(false);
  protected readonly page = signal(1);
  protected readonly pageSize = 10;
  protected readonly total = signal(0);

  /**
   * 操作者：`user_name` 是寫入當下查的，查不到就是空（#2006 使用者截圖的「—」）。
   * 沒有 userId＝系統自己做的；有 userId 卻沒有名字＝不明。
   */
  protected actorName(log: AuditLog): string {
    return log.userName ?? (log.userId ? '不明' : '系統');
  }

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

  protected onPage(event: PaginatorState): void {
    this.page.set((event.page ?? 0) + 1);
    this.loadPage();
  }

  protected onTab(value: string | number | undefined): void {
    const next = Number(value ?? 0);
    if (next === this.tabIndex()) return;
    this.tabIndex.set(next);
    this.page.set(1);
    this.loadPage();
  }

  /** `protected` 而不是 `private`：失敗態的重試鈕要在模板裡呼叫它（#812） */
  protected loadPage(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.auditLogsService
      .list({
        resourceTypes: [...this.resourceTypes()],
        page: this.page(),
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.logs.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        // 原本只關掉 loading —— **零訊號**，44 筆紀錄的對話框變成「尚無操作紀錄」（#812）
        error: () => {
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }
}
