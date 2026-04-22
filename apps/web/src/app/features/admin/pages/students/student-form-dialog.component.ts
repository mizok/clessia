import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { SchoolsService, type School } from '@core/schools.service';
import {
  StudentsService,
  type CreateStudentInput,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  type GradeLevel,
  type Student,
  type StudentGender,
  type UpdateStudentInput,
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
    TooltipModule,
  ],
  providers: [MessageService],
  templateUrl: './student-form-dialog.component.html',
  styleUrl: './student-form-dialog.component.scss',
})
export class StudentFormDialogComponent {
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly schoolsService = inject(SchoolsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly student = signal<Student | null>(this.config.data?.student ?? null);
  protected readonly isCreateMode = computed(() => this.student() === null);
  protected readonly schools = signal<School[]>([]);
  protected readonly creatingSchool = signal(false);
  protected readonly newSchoolName = signal('');

  protected readonly formData = signal({
    name: this.student()?.name ?? '',
    grade: (this.student()?.grade ?? '') as GradeLevel | '',
    schoolId: this.student()?.school?.id ?? null,
    birthday: this.student()?.birthday ? new Date(this.student()!.birthday!) : (null as Date | null),
    gender: this.student()?.gender ?? (null as StudentGender | null),
    phone: this.student()?.phone ?? '',
    email: this.student()?.email ?? '',
    address: this.student()?.address ?? '',
    emergencyContactName: this.student()?.emergencyContactName ?? '',
    emergencyContactPhone: this.student()?.emergencyContactPhone ?? '',
    notes: this.student()?.notes ?? '',
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
    return f.name.trim().length > 0 && f.grade.length > 0 && !!f.schoolId;
  });

  constructor() {
    this.schoolsService
      .list({ isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = [...res.data];
          const currentSchool = this.student()?.school;
          if (currentSchool && !list.some((school) => school.id === currentSchool.id)) {
            list.push({
              id: currentSchool.id,
              name: currentSchool.name,
              shortName: currentSchool.shortName,
              isActive: false,
              studentCount: 0,
              createdAt: '',
              updatedAt: '',
            });
          }
          this.schools.set(list);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學校清單',
          });
        },
      });
  }

  protected save(): void {
    if (!this.isFormValid()) return;

    const f = this.formData();
    this.loading.set(true);

    const commonFields = {
      name: f.name.trim(),
      grade: f.grade as GradeLevel,
      schoolId: f.schoolId,
      birthday: f.birthday ? this.formatDate(f.birthday) : null,
      gender: f.gender,
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      address: f.address.trim() || null,
      emergencyContactName: f.emergencyContactName.trim() || null,
      emergencyContactPhone: f.emergencyContactPhone.trim() || null,
      notes: f.notes.trim() || null,
    };

    if (this.isCreateMode()) {
      const input: CreateStudentInput = {
        ...commonFields,
        parentId: this.config.data?.parentId ?? undefined,
      };
      this.studentsService.create(input).subscribe({
        next: (res) => this.ref.close(res.data),
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '建立失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    } else {
      const input: UpdateStudentInput = commonFields;
      this.studentsService.update(this.student()!.id, input).subscribe({
        next: (res) => this.ref.close(res.data),
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
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected quickCreateSchool(): void {
    const name = this.newSchoolName().trim();
    if (!name) return;

    this.schoolsService
      .create({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.schools.update((list) => [...list, res.data]);
          this.updateForm('schoolId', res.data.id);
          this.creatingSchool.set(false);
          this.newSchoolName.set('');
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err?.error?.error ?? '',
          });
        },
      });
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
