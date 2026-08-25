import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SchoolsService } from '@core/schools.service';
import type { School } from '@core/schools.service';

export interface SchoolFormResult {
  mode: 'create' | 'update';
  school: School | null;
}

export interface SchoolFormDialogData {
  editing: School | null;
}

@Component({
  selector: 'app-school-form-dialog',
  standalone: true,
  imports: [FormsModule, InputTextModule, ButtonModule, CheckboxModule],
  templateUrl: './school-form-dialog.component.html',
  styleUrl: './school-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolFormDialogComponent {
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<SchoolFormDialogData>);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly name = signal('');
  protected readonly shortName = signal('');
  protected readonly isActive = signal(true);
  protected readonly submitting = signal(false);

  protected readonly editing = computed(() => this.config.data?.editing ?? null);
  protected readonly mode = computed(() => (this.editing() ? 'update' : 'create'));
  protected readonly canSubmit = computed(
    () => this.name().trim().length > 0 && !this.submitting(),
  );

  constructor() {
    const school = this.editing();
    if (school) {
      this.name.set(school.name);
      this.shortName.set(school.shortName ?? '');
      this.isActive.set(school.isActive);
    }
  }

  protected submit(): void {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    const payload = {
      name: this.name().trim(),
      shortName: this.shortName().trim() || null,
      isActive: this.isActive(),
    };
    const existing = this.editing();
    if (existing) {
      this.schoolsService
        .update(existing.id, payload)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.handleSuccess('update', { ...existing, ...payload }),
          error: (error: unknown) => this.handleError(error),
        });
      return;
    }

    this.schoolsService
      .create(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.handleSuccess('create', res.data),
        error: (error: unknown) => this.handleError(error),
      });
  }

  protected close(): void {
    this.ref.close();
  }

  private handleSuccess(mode: SchoolFormResult['mode'], school: School): void {
    this.submitting.set(false);
    this.ref.close({ mode, school } satisfies SchoolFormResult);
  }

  private handleError(error: unknown): void {
    this.submitting.set(false);
    const apiError = error as { error?: { code?: string; error?: string } };
    const detail =
      apiError?.error?.code === 'DUPLICATE' ? '學校名稱已存在' : (apiError?.error?.error ?? '');
    this.messageService.add({ severity: 'error', summary: '儲存失敗', detail });
  }
}
