import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MessageService, ConfirmationService } from 'primeng/api';

// Services
import {
  CampusesService,
  Campus,
  CreateCampusInput,
  UpdateCampusInput,
} from '@core/campuses.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';

@Component({
  selector: 'app-campuses',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    ToggleSwitch,
    ToastModule,
    ConfirmDialogModule,
    TooltipModule,
    SkeletonModule,
    TagModule,
    IconFieldModule,
    InputIconModule,
    EmptyStateComponent,
    AuditLogDialogComponent,
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './campuses.page.html',
  styleUrl: './campuses.page.scss',
})
export class CampusesPage implements OnInit {
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // State
  readonly campuses = signal<Campus[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly dialogVisible = signal(false);
  readonly dialogLoading = signal(false);
  protected readonly auditLogVisible = signal(false);

  // Edit form state
  readonly editingCampus = signal<Campus | null>(null);
  readonly formData = signal<{
    name: string;
    address: string;
    phone: string;
    isActive: boolean;
  }>({
    name: '',
    address: '',
    phone: '',
    isActive: true,
  });

  // Computed
  readonly isEditing = computed(() => this.editingCampus() !== null);
  readonly dialogTitle = computed(() =>
    this.isEditing() ? '編輯分校' : '新增分校'
  );
  readonly filteredCampuses = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.campuses();
    return this.campuses().filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.address?.toLowerCase().includes(query) ||
        c.phone?.includes(query)
    );
  });
  readonly activeCampusCount = computed(
    () => this.campuses().filter((c) => c.isActive).length
  );
  readonly inactiveCampusCount = computed(
    () => this.campuses().filter((c) => !c.isActive).length
  );

  ngOnInit(): void {
    this.loadCampuses();
  }

  loadCampuses(): void {
    this.loading.set(true);
    this.campusesService.list({ pageSize: 100 }).subscribe({
      next: (res) => {
        this.campuses.set(res.data);
        this.loading.set(false);
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

  openCreateDialog(): void {
    this.editingCampus.set(null);
    this.formData.set({
      name: '',
      address: '',
      phone: '',
      isActive: true,
    });
    this.dialogVisible.set(true);
  }

  openEditDialog(campus: Campus): void {
    this.editingCampus.set(campus);
    this.formData.set({
      name: campus.name,
      address: campus.address || '',
      phone: campus.phone || '',
      isActive: campus.isActive,
    });
    this.dialogVisible.set(true);
  }

  closeDialog(): void {
    this.dialogVisible.set(false);
    this.editingCampus.set(null);
  }

  saveCampus(): void {
    const form = this.formData();

    if (!form.name.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫分校名稱',
        detail: '分校名稱為必填欄位',
      });
      return;
    }

    this.dialogLoading.set(true);

    if (this.isEditing()) {
      const campus = this.editingCampus()!;
      const input: UpdateCampusInput = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        isActive: form.isActive,
      };

      this.campusesService.update(campus.id, input).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${form.name}」已更新`,
          });
          this.closeDialog();
          this.loadCampuses();
          this.dialogLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to update campus', err);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.dialogLoading.set(false);
        },
      });
    } else {
      const input: CreateCampusInput = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
      };

      this.campusesService.create(input).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.name}」已建立`,
          });
          this.closeDialog();
          this.loadCampuses();
          this.dialogLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to create campus', err);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.dialogLoading.set(false);
        },
      });
    }
  }

  confirmDelete(campus: Campus): void {
    this.confirmationService.confirm({
      message: `確定要刪除「${campus.name}」嗎？此操作無法復原。`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteCampus(campus),
    });
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
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  updateName(value: string): void {
    this.formData.update((f) => ({ ...f, name: value }));
  }

  updateAddress(value: string): void {
    this.formData.update((f) => ({ ...f, address: value }));
  }

  updatePhone(value: string): void {
    this.formData.update((f) => ({ ...f, phone: value }));
  }

  updateIsActive(value: boolean): void {
    this.formData.update((f) => ({ ...f, isActive: value }));
  }
}
