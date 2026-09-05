import { Component, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { RouteObj } from '@core/smart-enums/routes-catalog';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  BILLING_MODE_LABELS,
  FeeTemplatesService,
  type FeeTemplate,
} from '@core/fee-templates.service';
import { BillingPeriodsService, type BillingPeriod } from '@core/billing-periods.service';

import { PageActionsComponent } from '@shared/components/page-actions/page-actions.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';

import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { FeeTemplateFormDialogComponent } from './fee-template-form-dialog/fee-template-form-dialog.component';
import { BillingPeriodFormDialogComponent } from './billing-period-form-dialog/billing-period-form-dialog.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

/**
 * 費用方案管理 —— 見 kb/wiki/specs/admin/finance/fee-templates.md。
 *
 * 一頁兩個實體：**價目表**（org 層定價）與**收費期間**（機構自訂的具名日期區間）。
 * 收費期間是個位數到十幾筆、只有期繳用得到，另開一頁不划算，所以放在同一頁的第二區塊。
 *
 * 兩支 API 都**沒有分頁**（十幾筆的量級），所以這裡沒有 pagination 狀態，
 * 搜尋與篩選直接打後端。兩個區塊**各自取數、各自失敗** —— 收費期間掛了不該讓價目表空白。
 */
@Component({
  selector: 'app-admin-fee-templates',
  standalone: true,
  imports: [
    StatusDotComponent,
    DecimalPipe,
    FormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    ToastModule,
    PageActionsComponent,
    EmptyStateComponent,
    PopupMenuComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './fee-templates.component.html',
  styleUrl: './fee-templates.component.scss',
})
export class FeeTemplatesComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly BILLING_MODE_LABELS = BILLING_MODE_LABELS;

  protected readonly templates = signal<FeeTemplate[]>([]);
  protected readonly templatesLoading = signal(true);
  protected readonly searchQuery = signal('');
  protected readonly showInactive = signal(false);

  protected readonly periods = signal<BillingPeriod[]>([]);
  protected readonly periodsLoading = signal(true);

  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedTemplate = signal<FeeTemplate | null>(null);
  protected readonly periodMenu = viewChild.required<PopupMenuComponent>('periodMenu');
  protected readonly selectedPeriod = signal<BillingPeriod | null>(null);

  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const target = this.selectedTemplate();
    if (!target) return [];
    return [
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openTemplateDialog(target) },
      { separator: true },
      {
        label: target.isActive ? '停用' : '啟用',
        icon: target.isActive ? 'pi pi-lock' : 'pi pi-unlock',
        command: () => this.setTemplateActive(target, !target.isActive),
      },
      {
        label: '刪除',
        icon: 'pi pi-trash',
        command: () => this.confirmDeleteTemplate(target),
      },
    ];
  });

  protected readonly periodMenuItems = computed<MenuItem[]>(() => {
    const target = this.selectedPeriod();
    if (!target) return [];
    return [
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openPeriodDialog(target) },
      { separator: true },
      { label: '刪除', icon: 'pi pi-trash', command: () => this.confirmDeletePeriod(target) },
    ];
  });

  ngOnInit(): void {
    this.loadTemplates();
    this.loadPeriods();
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      header: '費用方案操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        resourceTypes: ['fee_template'],
      },
    });
  }

  // ── 價目表 ────────────────────────────────────────────────────────────────

  protected loadTemplates(): void {
    this.templatesLoading.set(true);
    this.feeTemplatesService
      .list({
        search: this.searchQuery() || undefined,
        // 停用不刪除：預設只看啟用中的，但停用的要找得回來（歷史報名還引用著）
        isActive: this.showInactive() ? undefined : true,
      })
      .subscribe({
        next: (res) => {
          this.templates.set(res.data);
          this.templatesLoading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入價目表',
          });
          this.templatesLoading.set(false);
        },
      });
  }

  protected onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.loadTemplates();
  }

  protected toggleShowInactive(): void {
    this.showInactive.update((v) => !v);
    this.loadTemplates();
  }

  protected openTemplateActionMenu(event: MouseEvent, target: FeeTemplate): void {
    this.selectedTemplate.set(target);
    this.actionMenu().toggle(event);
  }

  protected openTemplateDialog(target?: FeeTemplate): void {
    const ref = this.dialogService.open(FeeTemplateFormDialogComponent, {
      header: target ? '編輯價目表' : '新增價目表',
      width: '460px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { template: target ?? null },
    });
    ref?.onClose.subscribe((saved) => {
      if (saved) this.loadTemplates();
    });
  }

  private setTemplateActive(target: FeeTemplate, isActive: boolean): void {
    this.feeTemplatesService.update(target.id, { isActive }).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: isActive ? '已啟用' : '已停用',
          detail: `「${target.name}」${isActive ? '已重新啟用' : '不會再出現在報名選單'}`,
        });
        this.loadTemplates();
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '操作失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected confirmDeleteTemplate(target: FeeTemplate): void {
    this.confirm(
      '確認刪除',
      {
        message: `確定要刪除「${target.name}」嗎？此操作無法復原。已經被報名引用過的價目表刪不掉，請改為停用。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.deleteTemplate(target),
    );
  }

  /**
   * **不做樂觀更新。** FK 是 RESTRICT，被引用過的價目表後端會回 409 `IN_USE` ——
   * 先從陣列挑掉再回滾，中間那一瞬間畫面是騙人的，而且回滾很容易寫錯。
   * 成功就重新取數，失敗就只顯示錯誤、什麼都不動。
   */
  private deleteTemplate(target: FeeTemplate): void {
    this.feeTemplatesService.delete(target.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '刪除成功',
          detail: `「${target.name}」已刪除`,
        });
        this.loadTemplates();
      },
      error: (err) => {
        if (err.error?.code === 'IN_USE') {
          this.confirm(
            '無法刪除',
            {
              message: `「${target.name}」已經被報名引用，不能刪除。是否改為停用？停用後它不會出現在報名選單，但歷史報名仍看得懂。`,
              acceptLabel: '改為停用',
              rejectLabel: '取消',
              acceptSeverity: 'warn',
            },
            () => this.setTemplateActive(target, false),
          );
          return;
        }
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  // ── 收費期間 ──────────────────────────────────────────────────────────────

  protected loadPeriods(): void {
    this.periodsLoading.set(true);
    this.billingPeriodsService.list().subscribe({
      next: (res) => {
        this.periods.set(res.data);
        this.periodsLoading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入收費期間',
        });
        this.periodsLoading.set(false);
      },
    });
  }

  protected openPeriodActionMenu(event: MouseEvent, target: BillingPeriod): void {
    this.selectedPeriod.set(target);
    this.periodMenu().toggle(event);
  }

  protected openPeriodDialog(target?: BillingPeriod): void {
    const ref = this.dialogService.open(BillingPeriodFormDialogComponent, {
      header: target ? '編輯收費期間' : '新增收費期間',
      width: '460px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { period: target ?? null },
    });
    ref?.onClose.subscribe((saved) => {
      if (saved) this.loadPeriods();
    });
  }

  protected confirmDeletePeriod(target: BillingPeriod): void {
    this.confirm(
      '確認刪除',
      {
        message: `確定要刪除「${target.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.deletePeriod(target),
    );
  }

  private deletePeriod(target: BillingPeriod): void {
    this.billingPeriodsService.delete(target.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '刪除成功',
          detail: `「${target.name}」已刪除`,
        });
        this.loadPeriods();
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private confirm(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    ref?.onClose.subscribe((result) => {
      if (result) onAccept();
    });
  }
}
