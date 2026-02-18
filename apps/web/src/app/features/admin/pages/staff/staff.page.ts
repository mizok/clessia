import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageService, ConfirmationService } from 'primeng/api';

// Services
import {
  StaffService,
  Staff,
  StaffRole,
  Permission,
  CreateStaffInput,
  UpdateStaffInput,
} from '@core/staff.service';
import { CampusesService, Campus } from '@core/campuses.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

// Constants
const SUBJECT_OPTIONS = ['國文', '英文', '數學', '自然', '社會', '其他'];

const PERMISSION_OPTIONS: { value: Permission; label: string; description: string }[] = [
  { value: 'basic_operations', label: '日常行政', description: '查詢與處理報名、出勤、請假' },
  { value: 'manage_courses', label: '課程管理', description: '課程與排課管理' },
  { value: 'manage_students', label: '學生管理', description: '學生與家長資料管理' },
  { value: 'manage_finance', label: '財務管理', description: '財務與收費管理' },
  { value: 'manage_staff', label: '帳號管理', description: '系統帳號與權限管理' },
  { value: 'view_reports', label: '報表查看', description: '查看營收與統計報表' },
];

interface RoleOption {
  value: StaffRole;
  label: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  { value: 'admin', label: '管理員' },
  { value: 'teacher', label: '老師' },
];

@Component({
  selector: 'app-staff',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    ToggleSwitch,
    ToastModule,
    ConfirmDialogModule,
    TooltipModule,
    SkeletonModule,
    TagModule,
    IconFieldModule,
    InputIconModule,
    SelectModule,
    MultiSelectModule,
    DatePickerModule,
    TextareaModule,
    CheckboxModule,
    EmptyStateComponent,
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './staff.page.html',
  styleUrl: './staff.page.scss',
})
export class StaffPage implements OnInit {
  private readonly staffService = inject(StaffService);
  private readonly campusesService = inject(CampusesService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // Constants exposed to template
  protected readonly subjectOptions = SUBJECT_OPTIONS;
  protected readonly permissionOptions = PERMISSION_OPTIONS;
  protected readonly roleOptions = ROLE_OPTIONS;

  // State
  readonly staffList = signal<Staff[]>([]);
  readonly campuses = signal<Campus[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly roleFilter = signal<StaffRole | null>(null);
  readonly campusFilter = signal<string | null>(null);
  readonly subjectFilter = signal<string | null>(null);
  readonly dialogVisible = signal(false);
  readonly dialogLoading = signal(false);

  // Edit form state
  readonly editingStaff = signal<Staff | null>(null);
  readonly formData = signal<{
    displayName: string;
    email: string;
    phone: string;
    birthday: Date | null;
    notes: string;
    subjects: string[];
    campusIds: string[];
    roles: StaffRole[];
    permissions: Permission[];
    isActive: boolean;
  }>({
    displayName: '',
    email: '',
    phone: '',
    birthday: null,
    notes: '',
    subjects: [],
    campusIds: [],
    roles: ['teacher'],
    permissions: [],
    isActive: true,
  });

  // Computed
  readonly isEditing = computed(() => this.editingStaff() !== null);
  readonly dialogTitle = computed(() => (this.isEditing() ? '編輯人員' : '新增人員'));
  readonly isAdminRole = computed(() => this.formData().roles.includes('admin'));
  readonly isTeacherRole = computed(() => this.formData().roles.includes('teacher'));

  readonly filteredStaff = computed(() => {
    let list = this.staffList();
    const query = this.searchQuery().toLowerCase().trim();
    const role = this.roleFilter();
    const campusId = this.campusFilter();
    const subject = this.subjectFilter();

    if (query) {
      list = list.filter(
        (s) =>
          s.displayName.toLowerCase().includes(query) || s.email.toLowerCase().includes(query)
      );
    }

    if (role) {
      list = list.filter((s) => s.roles.includes(role));
    }

    if (campusId) {
      list = list.filter((s) => s.campusIds.includes(campusId));
    }

    if (subject) {
      list = list.filter((s) => s.subjects.includes(subject));
    }

    return list;
  });

  readonly adminCount = computed(() => this.staffList().filter((s) => s.roles.includes('admin')).length);
  readonly teacherCount = computed(
    () => this.staffList().filter((s) => s.roles.includes('teacher')).length
  );
  readonly activeCount = computed(() => this.staffList().filter((s) => s.isActive).length);

  readonly campusOptions = computed(() =>
    this.campuses().map((c) => ({ value: c.id, label: c.name }))
  );

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    // Load staff and campuses in parallel
    this.campusesService.list({ pageSize: 100 }).subscribe({
      next: (res) => this.campuses.set(res.data),
      error: (err) => console.error('Failed to load campuses', err),
    });

    this.staffService.list({ pageSize: 100 }).subscribe({
      next: (res) => {
        this.staffList.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load staff', err);
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入人員列表',
        });
        this.loading.set(false);
      },
    });
  }

  openCreateDialog(): void {
    this.editingStaff.set(null);
    this.formData.set({
      displayName: '',
      email: '',
      phone: '',
      birthday: null,
      notes: '',
      subjects: [],
      campusIds: [],
      roles: ['teacher'],
      permissions: [],
      isActive: true,
    });
    this.dialogVisible.set(true);
  }

  openEditDialog(staff: Staff): void {
    this.editingStaff.set(staff);
    this.formData.set({
      displayName: staff.displayName,
      email: staff.email,
      phone: staff.phone || '',
      birthday: staff.birthday ? new Date(staff.birthday) : null,
      notes: staff.notes || '',
      subjects: [...staff.subjects],
      campusIds: [...staff.campusIds],
      roles: [...staff.roles],
      permissions: [...staff.permissions],
      isActive: staff.isActive,
    });
    this.dialogVisible.set(true);
  }

  closeDialog(): void {
    this.dialogVisible.set(false);
    this.editingStaff.set(null);
  }

  saveStaff(): void {
    const form = this.formData();

    if (!form.displayName.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫姓名',
        detail: '姓名為必填欄位',
      });
      return;
    }

    if (!this.isEditing() && !form.email.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: '請填寫 Email',
        detail: 'Email 為必填欄位',
      });
      return;
    }

    if (form.campusIds.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '請選擇服務分校',
        detail: '至少需要選擇一個服務分校',
      });
      return;
    }

    if (form.roles.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '請選擇角色',
        detail: '至少需要選擇一個角色',
      });
      return;
    }

    if (form.roles.includes('teacher') && form.subjects.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '請選擇教學科目',
        detail: '老師至少需要選擇一個教學科目',
      });
      return;
    }

    this.dialogLoading.set(true);

    if (this.isEditing()) {
      const staff = this.editingStaff()!;
      const input: UpdateStaffInput = {
        displayName: form.displayName.trim(),
        phone: form.phone.trim() || null,
        birthday: form.birthday ? this.formatDate(form.birthday) : null,
        notes: form.notes.trim() || null,
        subjects: form.subjects,
        campusIds: form.campusIds,
        roles: form.roles,
        isActive: form.isActive,
        permissions: form.roles.includes('admin') ? form.permissions : [],
      };

      this.staffService.update(staff.id, input).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail: `「${form.displayName}」已更新`,
          });
          this.closeDialog();
          this.loadData();
          this.dialogLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to update staff', err);
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.dialogLoading.set(false);
        },
      });
    } else {
      const input: CreateStaffInput = {
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        birthday: form.birthday ? this.formatDate(form.birthday) : null,
        notes: form.notes.trim() || null,
        subjects: form.subjects,
        campusIds: form.campusIds,
        roles: form.roles,
        permissions: form.roles.includes('admin') ? form.permissions : [],
      };

      this.staffService.create(input).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.displayName}」已建立`,
          });
          this.closeDialog();
          this.loadData();
          this.dialogLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to create staff', err);
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.dialogLoading.set(false);
        },
      });
    }
  }

  confirmDelete(staff: Staff): void {
    this.confirmationService.confirm({
      message: `確定要刪除「${staff.displayName}」嗎？此操作無法復原。`,
      header: '確認刪除',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '刪除',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteStaff(staff),
    });
  }

  private deleteStaff(staff: Staff): void {
    this.staffService.delete(staff.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '刪除成功',
          detail: `「${staff.displayName}」已刪除`,
        });
        this.loadData();
      },
      error: (err) => {
        console.error('Failed to delete staff', err);
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  getCampusNames(campusIds: string[]): string {
    const campusMap = new Map(this.campuses().map((c) => [c.id, c.name]));
    return campusIds.map((id) => campusMap.get(id) || '未知').join('、');
  }

  getRoleLabel(role: StaffRole): string {
    return role === 'admin' ? '管理員' : '老師';
  }

  getRoleSeverity(role: StaffRole): 'info' | 'success' {
    return role === 'admin' ? 'info' : 'success';
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Form update methods
  updateDisplayName(value: string): void {
    this.formData.update((f) => ({ ...f, displayName: value }));
  }

  updateEmail(value: string): void {
    this.formData.update((f) => ({ ...f, email: value }));
  }

  updatePhone(value: string): void {
    this.formData.update((f) => ({ ...f, phone: value }));
  }

  updateBirthday(value: Date | null): void {
    this.formData.update((f) => ({ ...f, birthday: value }));
  }

  updateNotes(value: string): void {
    this.formData.update((f) => ({ ...f, notes: value }));
  }

  updateSubjects(value: string[]): void {
    this.formData.update((f) => ({ ...f, subjects: value }));
  }

  updateCampusIds(value: string[]): void {
    this.formData.update((f) => ({ ...f, campusIds: value }));
  }

  toggleRole(role: StaffRole, checked: boolean): void {
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
        // Clear permissions if no longer admin
        permissions: newRoles.includes('admin') ? f.permissions : [],
      };
    });
  }

  updateRoles(value: StaffRole[]): void {
    this.formData.update((f) => ({
      ...f,
      roles: value,
      permissions: value.includes('admin') ? f.permissions : [],
    }));
  }

  updatePermissions(value: Permission[]): void {
    this.formData.update((f) => ({ ...f, permissions: value }));
  }

  togglePermission(permission: Permission, checked: boolean): void {
    const current = this.formData().permissions;
    if (checked) {
      this.updatePermissions([...current, permission]);
    } else {
      this.updatePermissions(current.filter((p) => p !== permission));
    }
  }

  updateIsActive(value: boolean): void {
    this.formData.update((f) => ({ ...f, isActive: value }));
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.roleFilter.set(null);
    this.campusFilter.set(null);
    this.subjectFilter.set(null);
  }

  getDisplaySubjects(subjects: string[]): { visible: string[]; remaining: number } {
    const maxVisible = 2;
    if (subjects.length <= maxVisible) {
      return { visible: subjects, remaining: 0 };
    }
    return {
      visible: subjects.slice(0, maxVisible),
      remaining: subjects.length - maxVisible,
    };
  }
}
