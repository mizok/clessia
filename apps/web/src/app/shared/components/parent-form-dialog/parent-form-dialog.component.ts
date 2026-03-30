import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';
import {
  ParentsService,
  ParentDetail,
  CreateParentInput,
  UpdateParentInput,
} from '@core/parents.service';

@Component({
  selector: 'app-parent-form-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, TextareaModule, InlineNoticeComponent],
  templateUrl: './parent-form-dialog.component.html',
  styleUrl: './parent-form-dialog.component.scss',
})
export class ParentFormDialogComponent {
  private readonly parentsService = inject(ParentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly parent = signal<ParentDetail | null>(this.config.data?.parent ?? null);
  protected readonly isEditMode = computed(() => this.parent() !== null);

  protected readonly formData = signal({
    name: this.config.data?.parent?.name ?? '',
    email: this.config.data?.parent?.email ?? '',
    phone: this.config.data?.parent?.phone ?? '',
    notes: this.config.data?.parent?.notes ?? '',
  });

  protected readonly isFormValid = computed(() => {
    const f = this.formData();
    const hasName = f.name.trim().length > 0;
    const hasContact = f.email.trim().length > 0 || f.phone.trim().length > 0;
    return hasName && hasContact;
  });

  protected updateForm<K extends keyof ReturnType<typeof this.formData>>(
    field: K,
    value: ReturnType<typeof this.formData>[K],
  ): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    if (!this.isFormValid()) return;

    this.errorMessage.set(null);
    const f = this.formData();
    this.loading.set(true);

    if (this.isEditMode()) {
      const input: UpdateParentInput = {
        name: f.name.trim(),
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        notes: f.notes.trim() || null,
      };

      this.parentsService.update(this.parent()!.id, input).subscribe({
        next: (res) => this.ref.close({ type: 'updated', data: res.data }),
        error: (err) => this.handleError(err),
      });
    } else {
      const input: CreateParentInput = {
        name: f.name.trim(),
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        notes: f.notes.trim() || undefined,
      };

      this.parentsService.create(input).subscribe({
        next: (res) => this.ref.close({ type: 'created', data: res.data, password: res.initialPassword }),
        error: (err) => this.handleError(err),
      });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  private handleError(err: { error?: { error?: string } }): void {
    const code = err.error?.error;
    let message = '請稍後再試';
    if (code === 'DUPLICATE_EMAIL') message = '此 Email 已被使用';
    else if (code === 'DUPLICATE_PHONE') message = '此手機號碼已被使用';
    else if (code === 'CREATE_PARENT_FAILED') message = '建立帳號失敗，請稍後再試';
    else if (err.error?.error) message = err.error.error;

    this.errorMessage.set(message);
    this.loading.set(false);
  }
}
