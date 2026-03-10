import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService, ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { StaffFormDialogComponent } from './staff-form-dialog.component';

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
import { SubjectsService, Subject } from '@core/subjects.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { OverlayContainerService } from '@core/overlay-container.service';

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
    SelectModule,
    TagModule,
    ToastModule,
    ConfirmDialogModule,
    TooltipModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    EmptyStateComponent,
  ],
  providers: [MessageService, ConfirmationService, DialogService],
  templateUrl: './staff.page.html',
  styleUrl: './staff.page.scss',
})
export class StaffPage implements OnInit {
  private readonly dialogService = inject(DialogService);
  private readonly staffService = inject(StaffService);
  private readonly campusesService = inject(CampusesService);
  private readonly subjectsService = inject(SubjectsService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // Constants exposed to template
  protected readonly permissionOptions = PERMISSION_OPTIONS;
  protected readonly roleOptions = ROLE_OPTIONS;

  // State
  readonly staffList = signal<Staff[]>([]);
  readonly campuses = signal<Campus[]>([]);
  readonly subjects = signal<Subject[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly roleFilter = signal<StaffRole | null>(null);
  readonly campusFilter = signal<string | null>(null);
  readonly subjectFilter = signal<string | null>(null);

  // Computed
  readonly filteredStaff = computed(() => {
    let list = this.staffList();
    const query = this.searchQuery().toLowerCase().trim();
    const role = this.roleFilter();
    const campusId = this.campusFilter();
    const subjectId = this.subjectFilter();

    if (query) {
      list = list.filter(
        (s) => s.displayName.toLowerCase().includes(query) || s.email.toLowerCase().includes(query),
      );
    }

    if (role) {
      list = list.filter((s) => s.roles.includes(role));
    }

    if (campusId) {
      list = list.filter((s) => s.campusIds.includes(campusId));
    }

    if (subjectId) {
      list = list.filter((s) => s.subjectIds.includes(subjectId));
    }

    return list;
  });

  readonly adminCount = computed(
    () => this.staffList().filter((s) => s.roles.includes('admin')).length,
  );
  readonly teacherCount = computed(
    () => this.staffList().filter((s) => s.roles.includes('teacher')).length,
  );
  readonly activeCount = computed(() => this.staffList().filter((s) => s.isActive).length);

  readonly campusOptions = computed(() =>
    this.campuses().map((c) => ({ value: c.id, label: c.name })),
  );

  readonly subjectOptions = computed(() =>
    this.subjects().map((subject) => ({ value: subject.id, label: subject.name })),
  );

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    // Load staff and campuses in parallel
    this.campusesService.list({ pageSize: 100 }).subscribe({
      next: (res: { data: Campus[] }) => this.campuses.set(res.data),
      error: (err: any) => console.error('Failed to load campuses', err),
    });

    this.subjectsService.list().subscribe({
      next: (res: { data: Subject[] }) => this.subjects.set(res.data),
      error: (err: any) => console.error('Failed to load subjects', err),
    });

    this.staffService.list({ pageSize: 100 }).subscribe({
      next: (res: { data: Staff[] }) => {
        this.staffList.set(res.data);
        this.loading.set(false);
      },
      error: (err: any) => {
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
    const ref = this.dialogService.open(StaffFormDialogComponent, {
      header: '新增人員',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        campuses: this.campuses(),
        subjects: this.subjects(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) this.loadData();
      });
  }

  openEditDialog(staff: Staff): void {
    const ref = this.dialogService.open(StaffFormDialogComponent, {
      header: '編輯人員',
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        staff,
        campuses: this.campuses(),
        subjects: this.subjects(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) this.loadData();
      });
  }

  openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      header: '人員管理操作紀錄',
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        resourceTypes: ['staff'],
      },
    });
  }

  confirmArchive(staff: Staff): void {
    this.confirmationService.confirm({
      message: `確定要封存「${staff.displayName}」嗎？封存後帳號將無法登入，未來課堂指派將自動解除，但歷史紀錄會保留。`,
      header: '確認封存',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '封存',
      rejectLabel: '取消',
      acceptButtonStyleClass: 'p-button-warning',
      accept: () => this.archiveStaff(staff),
    });
  }

  private archiveStaff(staff: Staff): void {
    this.staffService.archive(staff.id).subscribe({
      next: (res) => {
        const detail = res.unassignedSessions > 0
          ? `「${staff.displayName}」已封存，${res.unassignedSessions} 堂未來課堂已設為待指派`
          : `「${staff.displayName}」已封存`;
        this.messageService.add({ severity: 'success', summary: '封存成功', detail });
        this.loadData();
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: '封存失敗',
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

  clearFilters(): void {
    this.searchQuery.set('');
    this.roleFilter.set(null);
    this.campusFilter.set(null);
    this.subjectFilter.set(null);
  }

  onSubjectsChanged(updated: Subject[]): void {
    this.subjects.set(updated);
  }

  getDisplaySubjects(subjectNames: string[]): { visible: string[]; remaining: number } {
    const maxVisible = 2;
    if (subjectNames.length <= maxVisible) {
      return { visible: subjectNames, remaining: 0 };
    }
    return {
      visible: subjectNames.slice(0, maxVisible),
      remaining: subjectNames.length - maxVisible,
    };
  }
}
