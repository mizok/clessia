import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import {
  StaffService,
  Staff,
  StaffRole,
  Permission,
  CreateStaffInput,
  UpdateStaffInput,
} from '@core/staff.service';
import { Campus } from '@core/campuses.service';
import { Subject } from '@core/subjects.service';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';

const PERMISSION_OPTIONS: { value: Permission; label: string; description: string }[] = [
  { value: 'basic_operations', label: '日常行政', description: '查詢與處理報名、出勤、請假' },
  { value: 'manage_courses', label: '課程管理', description: '課程與排課管理' },
  { value: 'manage_students', label: '學生管理', description: '學生與家長資料管理' },
  { value: 'manage_finance', label: '財務管理', description: '財務與收費管理' },
  { value: 'manage_staff', label: '帳號管理', description: '系統帳號與權限管理' },
  { value: 'view_reports', label: '報表查看', description: '查看營收與統計報表' },
];

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'admin', label: '管理員' },
  { value: 'teacher', label: '老師' },
];

@Component({
  selector: 'app-staff-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    ToggleSwitch,
    SelectModule,
    MultiSelectModule,
    DatePickerModule,
    TextareaModule,
    CheckboxModule,
  ],
  templateUrl: './staff-form-dialog.component.html',
  styleUrl: './staff-form-dialog.component.scss',
})
export class StaffFormDialogComponent {
  private readonly staffService = inject(StaffService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly permissionOptions = PERMISSION_OPTIONS;
  protected readonly roleOptions = ROLE_OPTIONS;

  protected readonly loading = signal(false);
  protected readonly staff = signal<Staff | null>(this.config.data?.staff ?? null);
  protected readonly campuses = signal<Campus[]>(this.config.data?.campuses ?? []);
  protected readonly subjects = signal<Subject[]>(this.config.data?.subjects ?? []);

  protected readonly formData = signal({
    displayName: this.staff()?.displayName ?? '',
    email: this.staff()?.email ?? '',
    phone: this.staff()?.phone ?? '',
    birthday: (this.staff()?.birthday
      ? new Date(this.staff()!.birthday as string)
      : null) as Date | null,
    notes: this.staff()?.notes ?? '',
    subjectIds: this.staff()?.subjectIds ?? [],
    campusIds: this.staff()?.campusIds ?? [],
    roles: this.staff()?.roles ?? ['teacher'],
    permissions: this.staff()?.permissions ?? [],
    isActive: this.staff()?.isActive ?? true,
  });

  protected readonly isEditing = computed(() => this.staff() !== null);
  protected readonly isAdminRole = computed(() => this.formData().roles.includes('admin'));
  protected readonly isTeacherRole = computed(() => this.formData().roles.includes('teacher'));

  protected readonly campusOptions = computed(() =>
    this.campuses().map((c) => ({ label: c.name, value: c.id })),
  );

  protected readonly subjectOptions = computed(() =>
    this.subjects().map((s) => ({ label: s.name, value: s.id })),
  );

  protected save(): void {
    const form = this.formData();
    if (!form.displayName.trim()) {
      this.messageService.add({ severity: 'warn', summary: '請填寫姓名' });
      return;
    }
    if (!this.isEditing() && !form.email.trim()) {
      this.messageService.add({ severity: 'warn', summary: '請填寫 Email' });
      return;
    }
    if (form.campusIds.length === 0) {
      this.messageService.add({ severity: 'warn', summary: '請選擇服務分校' });
      return;
    }
    if (form.roles.length === 0) {
      this.messageService.add({ severity: 'warn', summary: '請選擇角色' });
      return;
    }
    if (form.roles.includes('teacher') && form.subjectIds.length === 0) {
      this.messageService.add({ severity: 'warn', summary: '請選擇教學科目' });
      return;
    }

    this.loading.set(true);

    const commonInput = {
      displayName: form.displayName.trim(),
      phone: form.phone.trim() || null,
      birthday: form.birthday ? this.formatDate(form.birthday) : null,
      notes: form.notes.trim() || null,
      subjectIds: form.subjectIds,
      campusIds: form.campusIds,
      roles: form.roles,
      permissions: form.roles.includes('admin') ? form.permissions : [],
    };

    if (this.isEditing()) {
      const input: UpdateStaffInput = {
        ...commonInput,
        isActive: form.isActive,
      };

      this.staffService.update(this.staff()!.id, input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${form.displayName}」已更新`,
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
      const input: CreateStaffInput = {
        ...commonInput,
        email: form.email.trim(),
      };

      this.staffService.create(input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.displayName}」已建立`,
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

  protected toggleRole(role: StaffRole, checked: boolean): void {
    this.formData.update((f) => {
      let newRoles: StaffRole[];
      if (checked) {
        newRoles = f.roles.includes(role) ? f.roles : [...f.roles, role];
      } else {
        newRoles = f.roles.filter((r) => r !== role);
      }
      return {
        ...f,
        roles: newRoles,
        permissions: newRoles.includes('admin') ? f.permissions : [],
      };
    });
  }

  protected togglePermission(permission: Permission, checked: boolean): void {
    const current = this.formData().permissions;
    if (checked) {
      this.updateForm('permissions', [...current, permission]);
    } else {
      this.updateForm(
        'permissions',
        current.filter((p) => p !== permission),
      );
    }
  }

  protected openSubjectManager(): void {
    const dialogRef = this.dialogService.open(SubjectManagerComponent, {
      header: '管理科目',
      width: '400px',
      modal: true,
      showHeader: false,
    });

    if (dialogRef) {
      dialogRef.onClose.subscribe((updatedSubjects: Subject[]) => {
        if (updatedSubjects) {
          this.subjects.set(updatedSubjects);
        }
      });
    }
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
