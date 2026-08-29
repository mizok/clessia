import { Component, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

// Responsive Table
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { StaffFormDialogComponent } from './staff-form-dialog.component';
import { TeachingLogDialogComponent } from './teaching-log-dialog/teaching-log-dialog.component';

// Services
import {
  StaffService,
  Staff,
  StaffListResponse,
  StaffRole,
  StaffStatus,
  Permission,
} from '@core/staff.service';
import { CampusesService, Campus } from '@core/campuses.service';
import { SubjectsService, Subject } from '@core/subjects.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoginLinkDialogComponent } from '@shared/components/login-link-dialog/login-link-dialog.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { OverlayContainerService } from '@core/overlay-container.service';
import { ReferenceDataService } from '@core/reference-data.service';

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

interface StaffSummary {
  total: number;
  adminCount: number;
  teacherCount: number;
  activeCount: number;
  inactiveCount: number;
  archivedCount: number;
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
    ButtonModule,
    SelectModule,
    TagModule,
    ToastModule,
    TooltipModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    EmptyStateComponent,
    PopupMenuComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './staff.page.html',
  styleUrl: './staff.page.scss',
})
export class StaffPage implements OnInit {
  private readonly dialogService = inject(DialogService);
  private readonly staffService = inject(StaffService);
  private readonly campusesService = inject(CampusesService);
  private readonly subjectsService = inject(SubjectsService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly refData = inject(ReferenceDataService);
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // Constants exposed to template
  protected readonly permissionOptions = PERMISSION_OPTIONS;
  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly staffStatusOptions = [
    { value: 'active', label: '啟用中' },
    { value: 'inactive', label: '已停用' },
    { value: 'archived', label: '已封存' },
  ];

  // State
  readonly staffList = signal<Staff[]>([]);
  readonly campuses = signal<Campus[]>([]);
  readonly subjects = signal<Subject[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly roleFilter = signal<StaffRole | null>(null);
  readonly campusFilter = signal<string | null>(null);
  readonly subjectFilter = signal<string | null>(null);
  protected readonly staffStatusFilter = signal<StaffStatus | null>(null);
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);
  readonly summary = signal<StaffSummary>({
    total: 0,
    adminCount: 0,
    teacherCount: 0,
    activeCount: 0,
    inactiveCount: 0,
    archivedCount: 0,
  });
  protected readonly PAGE_SIZE = 8;

  // Computed
  readonly adminCount = computed(() => this.summary().adminCount);
  readonly teacherCount = computed(() => this.summary().teacherCount);
  readonly activeCount = computed(() => this.summary().activeCount);

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.total(),
  }));

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedStaff = signal<Staff | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const staff = this.selectedStaff();
    if (!staff) return [];
    const items: MenuItem[] = [
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openEditDialog(staff) },
      {
        label: '授課紀錄',
        icon: 'pi pi-history',
        command: () => this.openTeachingLog(staff),
      },
      {
        label: '產生登入連結',
        icon: 'pi pi-qrcode',
        disabled: staff.status === 'archived',
        command: () => this.issueLoginLink(staff),
      },
      { separator: true },
    ];
    if (staff.status === 'inactive') {
      items.push({
        label: '重新啟用',
        icon: 'pi pi-unlock',
        command: () => this.confirmDeactivate(staff),
      });
    } else if (staff.status === 'active') {
      items.push({
        label: '停用帳號',
        icon: 'pi pi-lock',
        command: () => this.confirmDeactivate(staff),
      });
    }
    if (staff.status !== 'archived') {
      items.push({
        label: '封存帳號',
        icon: 'pi pi-box',
        command: () => this.confirmArchive(staff),
      });
    }
    return items;
  });

  private openLoginLinkDialog(staff: Staff, loginUrl: string): void {
    this.dialogService.open(LoginLinkDialogComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { loginUrl, personName: staff.displayName },
    });
  }

  /**
   * 重發登入連結。取代原本「告知初始密碼」那條路 —— 這個系統沒有密碼了。
   * 連結會過期、只能用一次；密碼會被寫在便條紙上留著。
   */
  protected issueLoginLink(staff: Staff): void {
    if (!staff.userId) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法產生',
        detail: '這位人員還沒有帳號，無法產生連結',
      });
      return;
    }

    this.staffService.createLoginLink(staff.userId).subscribe({
      next: (res) => this.openLoginLinkDialog(staff, res.url),
      error: () => {
        this.messageService.add({ severity: 'error', summary: '產生失敗', detail: '請稍後再試' });
      },
    });
  }

  protected openActionMenu(event: MouseEvent, staff: Staff): void {
    this.selectedStaff.set(staff);
    this.actionMenu().toggle(event);
  }

  readonly campusOptions = computed(() =>
    this.campuses().map((c) => ({ value: c.id, label: c.name })),
  );

  readonly subjectOptions = computed(() =>
    this.subjects().map((subject) => ({ value: subject.id, label: subject.name })),
  );

  ngOnInit(): void {
    this.loadFilterOptions();
    this.loadStaff();
  }

  private loadFilterOptions(): void {
    this.campusesService.list({ pageSize: 100 }).subscribe({
      next: (res: { data: Campus[] }) => this.campuses.set(res.data),
      error: (err: any) => console.error('Failed to load campuses', err),
    });

    this.subjectsService.list().subscribe({
      next: (res: { data: Subject[] }) => this.subjects.set(res.data),
      error: (err: any) => console.error('Failed to load subjects', err),
    });
  }

  private loadStaff(): void {
    this.loading.set(true);
    this.staffService
      .list({
        search: this.searchQuery() || undefined,
        role: this.roleFilter() || undefined,
        campusId: this.campusFilter() || undefined,
        subjectId: this.subjectFilter() || undefined,
        status: this.staffStatusFilter() ?? undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res: StaffListResponse) => {
          this.staffList.set(res.data);
          this.total.set(res.meta.total);
          this.summary.set(res.summary);
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

  protected onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.currentPage.set(1);
    this.loadStaff();
  }

  protected onRoleFilterChange(value: StaffRole | null): void {
    this.roleFilter.set(value);
    this.currentPage.set(1);
    this.loadStaff();
  }

  protected onCampusFilterChange(value: string | null): void {
    this.campusFilter.set(value);
    this.currentPage.set(1);
    this.loadStaff();
  }

  protected onSubjectFilterChange(value: string | null): void {
    this.subjectFilter.set(value);
    this.currentPage.set(1);
    this.loadStaff();
  }

  protected onStaffStatusFilterChange(value: StaffStatus | null): void {
    this.staffStatusFilter.set(value);
    this.currentPage.set(1);
    this.loadStaff();
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.loadStaff();
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
      ref.onClose.subscribe((result?: { data?: Staff; loginUrl?: string | null }) => {
        if (result) {
          this.refData.invalidate('teachers');
          this.currentPage.set(1);
          this.loadStaff();

          // 建完立刻給連結：櫃檯把 QR 給對方掃，是綁定成功率最高的時刻
          if (result.data && result.loginUrl) {
            this.openLoginLinkDialog(result.data, result.loginUrl);
          }
        }
      });
  }

  /** 唯讀的授課紀錄檢視。不計算薪資，只呈現這位老師某段期間上了哪些課。 */
  openTeachingLog(staff: Staff): void {
    this.dialogService.open(TeachingLogDialogComponent, {
      header: `授課紀錄 · ${staff.displayName}`,
      width: '760px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: { staffId: staff.id, staffName: staff.displayName },
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
        if (result) {
          this.refData.invalidate('teachers');
          this.loadStaff();
        }
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
    this.openConfirmDialog(
      '確認封存',
      {
        message: `確定要封存「${staff.displayName}」嗎？封存後無法取消，帳號將永久停用且無法登入，未來課堂指派將自動解除，但歷史紀錄會保留。`,
        acceptLabel: '封存',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.archiveStaff(staff),
    );
  }

  private archiveStaff(staff: Staff): void {
    this.staffService.archive(staff.id).subscribe({
      next: (res) => {
        const detail =
          res.unassignedSessions > 0
            ? `「${staff.displayName}」已封存，${res.unassignedSessions} 堂未來課堂已設為待指派`
            : `「${staff.displayName}」已封存`;
        this.messageService.add({ severity: 'success', summary: '封存成功', detail });
        this.refData.invalidate('teachers');
        this.loadStaff();
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

  protected confirmDeactivate(staff: Staff): void {
    if (staff.status === 'inactive') {
      this.openConfirmDialog(
        '確認啟用',
        {
          message: `確定要重新啟用「${staff.displayName}」嗎？`,
          acceptLabel: '啟用',
          rejectLabel: '取消',
          acceptSeverity: 'success',
        },
        () => this.reactivateStaff(staff),
      );
      return;
    }

    this.openConfirmDialog(
      '確認停用',
      {
        message: `確定要停用「${staff.displayName}」嗎？停用後帳號將暫時無法使用，但角色與課堂指派會保留。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => this.deactivateStaff(staff),
    );
  }

  private deactivateStaff(staff: Staff): void {
    this.staffService.deactivate(staff.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '停用成功',
          detail: `「${staff.displayName}」已停用`,
        });
        this.refData.invalidate('teachers');
        this.loadStaff();
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private reactivateStaff(staff: Staff): void {
    this.staffService.activate(staff.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '啟用成功',
          detail: `「${staff.displayName}」已重新啟用`,
        });
        this.refData.invalidate('teachers');
        this.loadStaff();
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: '啟用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private openConfirmDialog(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    if (!ref) return;
    ref.onClose.subscribe((result) => {
      if (result) onAccept();
    });
  }

  protected getStaffStatusLabel(status: StaffStatus): string {
    if (status === 'active') return '啟用';
    if (status === 'inactive') return '停用';
    return '封存';
  }

  protected getStaffStatusSeverity(status: StaffStatus): 'success' | 'warn' | 'secondary' {
    if (status === 'active') return 'success';
    if (status === 'inactive') return 'warn';
    return 'secondary';
  }

  protected getStaffStatusText(status: StaffStatus): string {
    if (status === 'active') return '啟用中';
    if (status === 'inactive') return '已停用';
    return '已封存';
  }

  protected getPersonHue(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) & 0xfffffff;
    }
    const raw = hash % 320;
    return raw < 45 ? raw + 160 : raw;
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
    this.staffStatusFilter.set(null);
    this.currentPage.set(1);
    this.loadStaff();
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
