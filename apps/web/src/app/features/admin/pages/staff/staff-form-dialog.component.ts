import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import { OverlayContainerService } from '@core/overlay-container.service';
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
  { value: 'manage_roles', label: '角色管理', description: '指派或變更帳號角色與權限' },
  { value: 'view_reports', label: '報表查看', description: '查看營收與統計報表' },
  {
    value: 'all_campuses',
    label: '跨分校',
    description: '不受指派分校限制，看得到全機構的資料',
  },
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
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

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

  /**
   * 驗證失敗的欄位 → 訊息。**畫面上的主體訊號是這個，不是 toast。**
   *
   * #663：可用性測試席按下「建立」之後**什麼都沒發生**。實際上 toast 有出現，
   * 但它在畫面**對角**、而且壽命短於「把視線從右下的按鈕移到右上」所需的時間
   * （量測：等 1 秒看得到、等 4 秒什麼都沒有）。而欄位**從頭到尾沒有紅框**。
   *
   * **兩個本該互為備援的管道同時失效，結果不是「提示不夠明顯」，
   * 是「驗證失敗這件事在畫面上不存在」。**
   *
   * 所以錯誤存在**持久的**狀態裡，跟著欄位顯示，直到那個欄位被改動為止。
   * toast 留著當輔助（有人可能正看著右上），**但它不再是唯一的訊號**。
   */
  protected readonly errors = signal<Record<string, string>>({});

  /**
   * 回傳第一個錯誤的欄位 key，全部通過回 `null`。
   *
   * **一次收集全部**而不是遇到第一個就 return —— 使用者一次看到所有要補的東西，
   * 不用「修一個、再按一次、再發現下一個」。
   */
  private validate(): string | null {
    const form = this.formData();
    const found: Record<string, string> = {};

    if (!form.displayName.trim()) found['displayName'] = '請填寫姓名';
    if (!this.isEditing() && !form.email.trim()) found['email'] = '請填寫 Email';
    if (form.campusIds.length === 0) found['campusIds'] = '請選擇服務分校';
    if (form.roles.length === 0) found['roles'] = '請選擇角色';
    // **這個條件本來就跟角色綁**（#663 的 ② 查證後不是「沒有綁」）——
    // 不教書的人根本看不到這個欄位，因為整個區塊在 `@if (isTeacherRole())` 裡。
    if (form.roles.includes('teacher') && form.subjectIds.length === 0) {
      found['subjectIds'] = '請選擇教學科目';
    }

    this.errors.set(found);
    return Object.keys(found)[0] ?? null;
  }

  protected save(): void {
    const form = this.formData();
    const firstError = this.validate();
    if (firstError) {
      // toast 留著當**輔助** —— 有人的視線可能正好在右上。但它不再是唯一訊號，
      // 所以這裡不需要為了「讓人來得及看到」去延長它的壽命（那是治標）。
      this.messageService.add({
        severity: 'warn',
        summary: '請檢查標示的欄位',
        detail: this.errors()[firstError],
      });
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
      const input: UpdateStaffInput = commonInput;

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
          // loginUrl 一定要往上傳 —— 這個系統沒有密碼，那條連結是對方唯一的進門方式
          this.ref.close({ data: res.data, loginUrl: res.loginUrl });
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

  /** 改動一個欄位就清掉它的錯誤 —— 錯誤是「上次送出時的狀態」，不是永久標籤 */
  private clearError(field: string): void {
    if (!this.errors()[field]) return;
    this.errors.update((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
  }

  protected updateForm(field: keyof ReturnType<typeof this.formData>, value: any): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
    this.clearError(field as string);
  }

  protected toggleRole(role: StaffRole, checked: boolean): void {
    this.clearError('roles');
    // 取消老師角色時，「請選擇教學科目」就不再適用 —— 留著會變成一個
    // **指向一個已經不存在的欄位**的錯誤訊息
    this.clearError('subjectIds');
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
      width: '400px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer ?? 'body',
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
