import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { TextareaModule } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  ParentsService,
  ParentDetail,
  CreateParentInput,
  UpdateParentInput,
} from '@core/parents.service';
import { StudentsService } from '@core/students.service';

interface StudentOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-parent-form-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MultiSelectModule, TextareaModule],
  providers: [MessageService],
  templateUrl: './parent-form-dialog.component.html',
  styleUrl: './parent-form-dialog.component.scss',
})
export class ParentFormDialogComponent implements OnInit {
  private readonly parentsService = inject(ParentsService);
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly studentsLoading = signal(true);
  protected readonly studentOptions = signal<StudentOption[]>([]);

  protected readonly parent = signal<ParentDetail | null>(this.config.data?.parent ?? null);
  protected readonly isEditMode = computed(() => this.parent() !== null);

  protected readonly formData = signal({
    name: this.config.data?.parent?.name ?? '',
    email: this.config.data?.parent?.email ?? '',
    phone: this.config.data?.parent?.phone ?? '',
    studentIds: (this.config.data?.parent?.students ?? []).map((s: { id: string }) => s.id),
    notes: this.config.data?.parent?.notes ?? '',
  });

  protected readonly isFormValid = computed(() => {
    const f = this.formData();
    const hasName = f.name.trim().length > 0;
    const hasContact = f.email.trim().length > 0 || f.phone.trim().length > 0;
    return hasName && hasContact;
  });

  ngOnInit(): void {
    this.studentsService.list({ pageSize: 200 }).subscribe({
      next: (res) => {
        this.studentOptions.set(
          res.data.map((s) => ({ label: `${s.name}（${s.grade}）`, value: s.id })),
        );
        this.studentsLoading.set(false);
      },
      error: () => {
        this.studentsLoading.set(false);
      },
    });
  }

  protected updateForm<K extends keyof ReturnType<typeof this.formData>>(
    field: K,
    value: ReturnType<typeof this.formData>[K],
  ): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected save(): void {
    if (!this.isFormValid()) return;

    const f = this.formData();
    this.loading.set(true);

    if (this.isEditMode()) {
      const input: UpdateParentInput = {
        name: f.name.trim(),
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        studentIds: f.studentIds,
        notes: f.notes.trim() || null,
      };

      this.parentsService.update(this.parent()!.id, input).subscribe({
        next: (res) => this.ref.close({ type: 'updated', data: res.data }),
        error: (err) => this.handleError(err, '更新失敗'),
      });
    } else {
      const input: CreateParentInput = {
        name: f.name.trim(),
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        studentIds: f.studentIds.length > 0 ? f.studentIds : undefined,
        notes: f.notes.trim() || undefined,
      };

      this.parentsService.create(input).subscribe({
        next: (res) => this.ref.close({ type: 'created', data: res.data, password: res.initialPassword }),
        error: (err) => this.handleError(err, '建立失敗'),
      });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  private handleError(err: { error?: { error?: string } }, summary: string): void {
    const code = err.error?.error;
    let detail = '請稍後再試';
    if (code === 'DUPLICATE_EMAIL') detail = '此 Email 已被使用';
    else if (code === 'DUPLICATE_PHONE') detail = '此手機號碼已被使用';
    else if (code === 'CREATE_PARENT_FAILED') detail = '建立帳號失敗，請稍後再試';
    else if (err.error?.error) detail = err.error.error;

    this.messageService.add({ severity: 'error', summary, detail });
    this.loading.set(false);
  }
}
