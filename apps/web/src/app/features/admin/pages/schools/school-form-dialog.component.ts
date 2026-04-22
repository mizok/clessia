import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { SchoolsService } from '@core/schools.service';
import type { School } from '@core/schools.service';

export interface SchoolFormResult {
  mode: 'create' | 'update';
  school: School | null;
}

@Component({
  selector: 'app-school-form-dialog',
  standalone: true,
  imports: [FormsModule, DialogModule, InputTextModule, ButtonModule, CheckboxModule],
  templateUrl: './school-form-dialog.component.html',
  styleUrl: './school-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolFormDialogComponent implements OnInit {
  readonly editing = input<School | null>(null);
  readonly saved = output<SchoolFormResult>();
  readonly closed = output<void>();

  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);

  protected readonly visible = signal(true);
  protected readonly name = signal('');
  protected readonly shortName = signal('');
  protected readonly isActive = signal(true);
  protected readonly submitting = signal(false);

  protected readonly mode = computed(() => (this.editing() ? 'update' : 'create'));
  protected readonly canSubmit = computed(() => this.name().trim().length > 0 && !this.submitting());

  ngOnInit(): void {
    const school = this.editing();
    if (!school) return;

    this.name.set(school.name);
    this.shortName.set(school.shortName ?? '');
    this.isActive.set(school.isActive);
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
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: () => this.handleSuccess('update'),
          error: (error: unknown) => this.handleError(error),
        });
      return;
    }

    this.schoolsService
      .create(payload)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: () => this.handleSuccess('create'),
        error: (error: unknown) => this.handleError(error),
      });
  }

  protected onHide(): void {
    this.closed.emit();
  }

  private handleSuccess(mode: SchoolFormResult['mode']): void {
    this.submitting.set(false);
    this.visible.set(false);
    this.saved.emit({ mode, school: null });
  }

  private handleError(error: unknown): void {
    this.submitting.set(false);
    const apiError = error as { error?: { code?: string; error?: string } };
    const detail = apiError?.error?.code === 'DUPLICATE' ? '學校名稱已存在' : (apiError?.error?.error ?? '');
    this.messageService.add({ severity: 'error', summary: '儲存失敗', detail });
  }
}
