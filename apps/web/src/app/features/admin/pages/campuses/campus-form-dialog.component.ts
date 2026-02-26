import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  CampusesService,
  Campus,
  CreateCampusInput,
  UpdateCampusInput,
} from '@core/campuses.service';

@Component({
  selector: 'app-campus-form-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, ToggleSwitch],
  templateUrl: './campus-form-dialog.component.html',
  styleUrl: './campus-form-dialog.component.scss',
})
export class CampusFormDialogComponent {
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly campus = signal<Campus | null>(this.config.data?.campus ?? null);

  protected readonly formData = signal({
    name: this.campus()?.name ?? '',
    address: this.campus()?.address ?? '',
    phone: this.campus()?.phone ?? '',
    isActive: this.campus()?.isActive ?? true,
  });

  protected readonly isEditing = computed(() => this.campus() !== null);

  protected save(): void {
    const form = this.formData();
    if (!form.name.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫分校名稱',
        detail: '分校名稱為必填欄位',
      });
      return;
    }

    this.loading.set(true);

    if (this.isEditing()) {
      const input: UpdateCampusInput = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        isActive: form.isActive,
      };

      this.campusesService.update(this.campus()!.id, input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${form.name}」已更新`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    } else {
      const input: CreateCampusInput = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
      };

      this.campusesService.create(input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.name}」已建立`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected updateForm(field: keyof ReturnType<typeof this.formData>, value: any): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }
}
