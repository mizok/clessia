import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  StudentsService,
  Student,
  GradeLevel,
  StudentGender,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  UpdateStudentInput,
} from '@core/students.service';

@Component({
  selector: 'app-student-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TextareaModule,
    DatePickerModule,
  ],
  templateUrl: './student-form-dialog.component.html',
  styleUrl: './student-form-dialog.component.scss',
})
export class StudentFormDialogComponent {
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly student = signal<Student>(this.config.data.student);

  protected readonly formData = signal({
    name: this.student().name,
    grade: this.student().grade,
    school: this.student().school,
    birthday: this.student().birthday ? new Date(this.student().birthday!) : (null as Date | null),
    gender: this.student().gender,
    phone: this.student().phone ?? '',
    address: this.student().address ?? '',
    emergencyContactName: this.student().emergencyContactName ?? '',
    emergencyContactPhone: this.student().emergencyContactPhone ?? '',
    notes: this.student().notes ?? '',
  });

  protected readonly gradeOptions = GRADE_LEVELS.map((g) => ({
    label: GRADE_LEVEL_LABELS[g],
    value: g,
  }));

  protected readonly genderOptions: { label: string; value: StudentGender }[] = [
    { label: '男', value: 'male' },
    { label: '女', value: 'female' },
    { label: '不提供', value: 'prefer_not_to_say' },
  ];

  protected readonly isFormValid = computed(() => {
    const f = this.formData();
    return f.name.trim().length > 0 && f.grade.length > 0 && f.school.trim().length > 0;
  });

  protected save(): void {
    if (!this.isFormValid()) return;

    const f = this.formData();
    this.loading.set(true);

    const input: UpdateStudentInput = {
      name: f.name.trim(),
      grade: f.grade,
      school: f.school.trim(),
      birthday: f.birthday ? this.formatDate(f.birthday) : null,
      gender: f.gender,
      phone: f.phone.trim() || null,
      address: f.address.trim() || null,
      emergencyContactName: f.emergencyContactName.trim() || null,
      emergencyContactPhone: f.emergencyContactPhone.trim() || null,
      notes: f.notes.trim() || null,
    };

    this.studentsService.update(this.student().id, input).subscribe({
      next: (res) => {
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
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected updateForm<K extends keyof ReturnType<typeof this.formData>>(
    field: K,
    value: ReturnType<typeof this.formData>[K],
  ): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
