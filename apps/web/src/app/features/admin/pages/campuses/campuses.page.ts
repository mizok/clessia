import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { CampusFormDialogComponent } from './campus-form-dialog.component';

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

import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule } from 'primeng/paginator';

@Component({
  selector: 'app-campuses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputIconModule,
    IconFieldModule,
    ToastModule,
    TagModule,
    TooltipModule,
    SkeletonModule,
    InputTextModule,
    PaginatorModule,
    EmptyStateComponent,
    ConfirmDialogComponent,
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
  protected readonly PAGE_SIZE = 20;
  protected readonly showInactiveCampuses = signal(false);

  // Computed
  readonly activeCampusCount = computed(() => this.summary().activeCount);
  readonly inactiveCampusCount = computed(() => this.summary().inactiveCount);

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

  protected onPageChange(page: number): void {
    this.currentPage.set(page);
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
