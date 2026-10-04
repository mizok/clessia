import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from 'primeng/autocomplete';
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
import { StudentsService, type Student } from '@core/students.service';

@Component({
  selector: 'app-parent-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    AutoCompleteModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InlineNoticeComponent,
  ],
  templateUrl: './parent-form-dialog.component.html',
  styleUrl: './parent-form-dialog.component.scss',
})
export class ParentFormDialogComponent {
  private readonly parentsService = inject(ParentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly studentsService = inject(StudentsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly parent = signal<ParentDetail | null>(this.config.data?.parent ?? null);
  protected readonly isEditMode = computed(() => this.parent() !== null);

  /**
   * 新增模式的預填（#1245：從公開申請建立家長）。**不是 `parent`** —— 有 `parent` 就是編輯模式。
   */
  private readonly prefill: { name?: string; email?: string | null; phone?: string | null } =
    this.config.data?.prefill ?? {};

  protected readonly formData = signal({
    name: this.config.data?.parent?.name ?? this.prefill.name ?? '',
    email: this.config.data?.parent?.email ?? this.prefill.email ?? '',
    phone: this.config.data?.parent?.phone ?? this.prefill.phone ?? '',
    notes: this.config.data?.parent?.notes ?? '',
  });

  protected selectedStudents: Student[] = [];
  protected readonly studentSuggestions = signal<Student[]>([]);

  protected searchStudents(event: AutoCompleteCompleteEvent): void {
    const picked = new Set(this.selectedStudents.map((s) => s.id));
    this.studentsService
      .list({ search: event.query, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data.filter((s) => !picked.has(s.id))),
        error: () => this.studentSuggestions.set([]),
      });
  }

  protected updateForm<K extends keyof ReturnType<typeof this.formData>>(
    field: K,
    value: ReturnType<typeof this.formData>[K],
  ): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    const f = this.formData();

    // 按鈕刻意不 disable——disable 會把「為什麼不行」藏起來，而使用者按下去
    // 之前完全看不出缺什麼。這裡按得下去，缺什麼就直接說。
    if (!f.name.trim()) {
      this.errorMessage.set('請先輸入姓名');
      return;
    }
    if (!f.email.trim() && !f.phone.trim()) {
      this.errorMessage.set('Email 與手機號碼至少要填一個');
      return;
    }

    this.errorMessage.set(null);
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
        studentIds: this.selectedStudents.length
          ? this.selectedStudents.map((s) => s.id)
          : undefined,
      };

      this.parentsService.create(input).subscribe({
        next: (res) => this.ref.close({ type: 'created', data: res.data, loginUrl: res.loginUrl }),
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
