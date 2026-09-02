import { Component, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { CampusFormDialogComponent } from './campus-form-dialog.component';

// Responsive Table
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

// Services
import {
  CampusesService,
  Campus,
  CampusListResponse,
  CreateCampusInput,
  UpdateCampusInput,
} from '@core/campuses.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { ReferenceDataService } from '@core/reference-data.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';

import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

@Component({
  selector: 'app-campuses',
  standalone: true,
  imports: [
    StatusDotComponent,
    CommonModule,
    FormsModule,
    ButtonModule,
    InputIconModule,
    IconFieldModule,
    ToastModule,
    TooltipModule,
    SkeletonModule,
    InputTextModule,
    EmptyStateComponent,
    PopupMenuComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './campuses.page.html',
  styleUrl: './campuses.page.scss',
})
export class CampusesPage implements OnInit {
  readonly summary = signal({
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
  });
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly refData = inject(ReferenceDataService);
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // State
  readonly campuses = signal<Campus[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);
  protected readonly PAGE_SIZE = 8;
  protected readonly showInactiveCampuses = signal(false);

  // Computed
  readonly activeCampusCount = computed(() => this.summary().activeCount);
  readonly inactiveCampusCount = computed(() => this.summary().inactiveCount);

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedCampus = signal<Campus | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const campus = this.selectedCampus();
    if (!campus) return [];
    const items: MenuItem[] = [
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openEditDialog(campus) },
      { separator: true },
    ];
    if (campus.isActive) {
      items.push({
        label: '停用分校',
        icon: 'pi pi-lock',
        command: () => this.confirmDeactivate(campus),
      });
    } else {
      items.push({
        label: '啟用分校',
        icon: 'pi pi-unlock',
        command: () => this.confirmActivate(campus),
      });
    }
    items.push({
      label: '刪除分校',
      icon: 'pi pi-trash',
      command: () => this.confirmDelete(campus),
    });
    return items;
  });

  protected openActionMenu(event: MouseEvent, campus: Campus): void {
    this.selectedCampus.set(campus);
    this.actionMenu().toggle(event);
  }

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.total(),
  }));

  ngOnInit(): void {
    this.loadCampuses();
  }

  protected toggleShowInactiveCampuses(): void {
    this.showInactiveCampuses.set(!this.showInactiveCampuses());
    this.currentPage.set(1);
    this.loadCampuses();
  }

  loadCampuses(): void {
    this.loading.set(true);
    this.campusesService
      .list({
        search: this.searchQuery() || undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
        isActive: this.showInactiveCampuses() ? undefined : true,
      })
      .subscribe({
        next: (res: CampusListResponse) => {
          this.campuses.set(res.data);
          this.total.set(res.meta.total);
          this.summary.set(res.summary);
          this.loading.set(false);
          this.refData.invalidate('campuses');
        },
        error: (err) => {
          console.error('Failed to load campuses', err);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入分校列表',
          });
          this.loading.set(false);
        },
      });
  }

  protected onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
    this.loadCampuses();
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.loadCampuses();
  }

  openCreateDialog(): void {
    const ref = this.dialogService.open(CampusFormDialogComponent, {
      header: '新增分校',
      width: '450px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });

    if (ref) {
      ref.onClose.subscribe((newCampus) => {
        if (newCampus) this.loadCampuses();
      });
    }
  }

  openEditDialog(campus: Campus): void {
    const ref = this.dialogService.open(CampusFormDialogComponent, {
      header: '編輯分校',
      width: '450px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { campus },
    });

    if (ref) {
      ref.onClose.subscribe((updatedCampus) => {
        if (updatedCampus) this.loadCampuses();
      });
    }
  }

  openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      header: '分校管理操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { resourceTypes: ['campus'] },
    });
  }

  confirmDelete(campus: Campus): void {
    this.openConfirmDialog(
      '確認刪除',
      {
        message: `確定要刪除「${campus.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.deleteCampus(campus),
    );
  }

  private deleteCampus(campus: Campus): void {
    this.campusesService.delete(campus.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '刪除成功',
          detail: `「${campus.name}」已刪除`,
        });
        this.loadCampuses();
      },
      error: (err) => {
        console.error('Failed to delete campus', err);
        if (err.error?.code === 'HAS_COURSES') {
          this.openConfirmDialog(
            '無法刪除',
            {
              message: `「${campus.name}」底下還有課程，無法刪除。是否改為停用？`,
              acceptLabel: '停用',
              rejectLabel: '取消',
              acceptSeverity: 'warn',
            },
            () => this.deactivateCampus(campus),
          );
        } else {
          this.messageService.add({
            severity: 'error',
            summary: '刪除失敗',
            detail: err.error?.error || '請稍後再試',
          });
        }
      },
    });
  }

  confirmDeactivate(campus: Campus): void {
    this.openConfirmDialog(
      '停用分校',
      {
        message: `確定要停用「${campus.name}」嗎？停用後該分校將無法新增課程。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => this.deactivateCampus(campus),
    );
  }

  confirmActivate(campus: Campus): void {
    this.openConfirmDialog(
      '啟用分校',
      {
        message: `確定要啟用「${campus.name}」嗎？`,
        acceptLabel: '啟用',
        rejectLabel: '取消',
        acceptSeverity: 'success',
      },
      () => this.activateCampus(campus),
    );
  }

  private deactivateCampus(campus: Campus): void {
    this.campusesService.update(campus.id, { isActive: false }).subscribe({
      next: () => {
        if (!this.showInactiveCampuses()) this.showInactiveCampuses.set(true);
        this.loadCampuses();
        this.messageService.add({
          severity: 'success',
          summary: '已停用',
          detail: `「${campus.name}」已停用`,
        });
      },
      error: (err) => {
        console.error('Failed to deactivate campus', err);
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private activateCampus(campus: Campus): void {
    this.campusesService.update(campus.id, { isActive: true }).subscribe({
      next: () => {
        this.loadCampuses();
        this.messageService.add({
          severity: 'success',
          summary: '已啟用',
          detail: `「${campus.name}」已啟用`,
        });
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '啟用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private openConfirmDialog(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    if (!ref) return;
    ref.onClose.subscribe((result) => {
      if (result) onAccept();
    });
  }
}
