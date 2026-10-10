import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';
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
  type FeeTemplateListItem,
} from '@core/fee-templates.service';
import {
  BillingPeriodsService,
  type BillingPeriod,
  type BillingPeriodListItem,
} from '@core/billing-periods.service';

import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';

import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { FeeTemplateFormDialogComponent } from './fee-template-form-dialog/fee-template-form-dialog.component';
import { BillingPeriodFormDialogComponent } from './billing-period-form-dialog/billing-period-form-dialog.component';
import { FilterChipComponent } from '@shared/components/filter-chip/filter-chip.component';
import { inUseLabel, periodUsageLabel, overlappingNames, amountUnit } from './fee-templates.util';

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
    ChapterHeadComponent,
    DecimalPipe,
    FormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    ToastModule,
    PageActionsComponent,
    PageOpenComponent,
    EmptyStateComponent,
    LoadFailedComponent,
    PopupMenuComponent,
    FilterChipComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './fee-templates.component.html',
})
export class FeeTemplatesComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly feeTemplatesService = inject(FeeTemplatesService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly BILLING_MODE_LABELS = BILLING_MODE_LABELS;

  protected readonly inUseLabel = inUseLabel;
  protected readonly periodUsageLabel = periodUsageLabel;
  protected readonly amountUnit = amountUnit;

  protected readonly primaryAction: PageAction = { label: '新增價目表', icon: 'pi pi-plus' };
  protected readonly secondaryAction: PageAction = { label: '新增期間', icon: 'pi pi-plus' };

  protected readonly templates = signal<FeeTemplateListItem[]>([]);
  protected readonly templatesLoading = signal(true);

  /**
   * 取數失敗。**跟「清單長度 0」是兩件事** —— 錯誤被吃掉之後兩者在狀態上相同，
   * 而畫面只看狀態，於是失敗被渲染成「尚未有資料」（#788）。
   */
  protected readonly loadFailed = signal(false);
  protected readonly searchQuery = signal('');

  /**
   * **所有**取數都經過這裡，然後 `switchMap` 出去。
   *
   * 搜尋改在前端過濾後不再有輸入打出的請求，但重整（儲存、停用、刪除之後）仍可能連發，
   * 讓每一個取數都走同一條 `switchMap`，新的一發就取消舊的那一支。
   */
  private readonly loadRequests = new Subject<void>();
  private readonly destroyRef = inject(DestroyRef);
  protected readonly showInactive = signal(false);

  /**
   * 價目表一次取全部（含停用）、搜尋與「顯示停用」都在前端過濾（#1314 F0）：色面的「N 種／M 種」
   * 與「顯示停用方案（N）」要含停用的數字，而 API 本來就沒分頁、量級十幾筆。
   */
  protected readonly activeCount = computed(
    () => this.templates().filter((t) => t.isActive).length,
  );
  protected readonly inactiveCount = computed(() => this.templates().length - this.activeCount());
  protected readonly visibleTemplates = computed(() => {
    const q = this.searchQuery().trim();
    return this.templates().filter(
      (t) => (this.showInactive() || t.isActive) && (!q || t.name.includes(q)),
    );
  });

  /** 依計費模式分章（A6 F0）：沒有列的章不顯示；章內啟用在前、再依定價由低到高 */
  protected readonly chapters = computed(() => {
    const rows = this.visibleTemplates();
    return (['monthly', 'period', 'session_pack'] as const)
      .map((mode) => ({
        mode,
        label: BILLING_MODE_LABELS[mode],
        rows: rows
          .filter((t) => t.billingMode === mode)
          .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.amount - b.amount),
      }))
      .filter((c) => c.rows.length > 0);
  });

  protected readonly periods = signal<BillingPeriodListItem[]>([]);

  /** 這段期間跟哪些期間重疊（F5）。由已載入的列表算，不擋、不多一次請求 */
  protected overlapsOf(period: BillingPeriodListItem): string[] {
    return overlappingNames(period, this.periods());
  }

  protected formatRange(period: BillingPeriod): string {
    return `${period.startDate.replaceAll('-', '/')} — ${period.endDate.replaceAll('-', '/')}`;
  }
  protected readonly periodsLoading = signal(true);

  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedTemplate = signal<FeeTemplateListItem | null>(null);
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
      // F2：有人在用就直接說明、不給刪除（後端 FK RESTRICT 本來就會擋；這裡不讓人白按一次）
      target.inUseCount > 0
        ? {
            label: `${target.inUseCount} 筆報名在用，無法刪除`,
            icon: 'pi pi-trash',
            disabled: true,
          }
        : {
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
    this.setupLoadPipeline();

    // 搜尋：節流 + 去重，然後才觸發取數。
    // 去重比對的是 `searchQuery` signal 而不是 `distinctUntilChanged` ——
    // 後者的記憶是這個狀態的第二份複本，任何不經過這條管線的重設都會讓它
    // 跟畫面脫鉤，然後靜靜吞掉下一次同樣的字。
    this.loadTemplates();
    this.loadPeriods();
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
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

  /** 觸發取數。實際的請求在 `ngOnInit` 的那條 `switchMap` 管線裡（#661） */
  protected loadTemplates(): void {
    this.templatesLoading.set(true);
    this.loadFailed.set(false);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.loadRequests
      .pipe(
        switchMap(() =>
          this.feeTemplatesService

            .list()
            // **`catchError` 必須在內層，不能掛在外層 `pipe` 上。**
            // 所有取數收進單一管線之後，內層的 error 會終止外層 ——
            // **一次網路錯誤就讓這一頁再也載入不了任何東西**，而畫面上只有一則
            // toast，看起來像「這次失敗了」不是「這一頁壞了」。
            // 由 spec 的「一次請求失敗之後…」那條釘住（#689）。
            .pipe(
              catchError(() => {
                // **不再發 toast** —— 主體現在有常駐的失敗狀態（照 /admin/payments）。
                // 會消失的 toast + 留著的錯誤畫面＝兩個互相矛盾的訊號（#788）。
                this.loadFailed.set(true);
                this.templatesLoading.set(false);
                // `EMPTY` 照舊 —— #689 的修法，拆掉整條管線會死在第一次錯誤上。
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.templates.set(res.data);
        this.templatesLoading.set(false);
      });
  }

  protected onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  protected toggleShowInactive(): void {
    this.showInactive.update((v) => !v);
  }

  protected openTemplateActionMenu(event: MouseEvent, target: FeeTemplateListItem): void {
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
