import {
  Component,
  OnInit,
  DestroyRef,
  inject,
  signal,
  computed,
  input,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

// Responsive Table
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

// Services
import { ParentsService, Parent, ParentStatus, PARENT_STATUS_LABELS } from '@core/parents.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { LoginLinkDialogComponent } from '@shared/components/login-link-dialog/login-link-dialog.component';
import { ParentFormDialogComponent } from '@shared/components/parent-form-dialog/parent-form-dialog.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { StudentFormDialogComponent } from '@features/admin/pages/students/student-form-dialog.component';
import { ParentImportDialogComponent } from './parent-import-dialog/parent-import-dialog.component';
import { ParentDetailDialogComponent } from './parent-detail-dialog/parent-detail-dialog.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';

@Component({
  selector: 'app-parents',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputIconModule,
    IconFieldModule,
    ToastModule,
    TagModule,
    TooltipModule,
    SkeletonModule,
    InputTextModule,
    SelectModule,
    EmptyStateComponent,
    PopupMenuComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './parents.page.html',
  styleUrl: './parents.page.scss',
})
export class ParentsPage implements OnInit {
  private readonly parentsService = inject(ParentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly destroyRef = inject(DestroyRef);
  readonly page = input.required<RouteObj>();

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected static readonly PAGE_SIZE = LIST_PAGE_SIZE;
  protected readonly PAGE_SIZE = ParentsPage.PAGE_SIZE;
  protected readonly statusLabels = PARENT_STATUS_LABELS;

  // State
  protected readonly parents = signal<Parent[]>([]);
  protected readonly loading = signal(true);
  protected readonly searchQuery = signal('');
  protected readonly selectedStatus = signal<ParentStatus | null>(null);
  protected readonly summary = signal({
    total: 0,
    activeCount: 0,
    inactiveCount: 0,
    archivedCount: 0,
  });
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);

  private readonly searchSubject = new Subject<string>();

  // Status options
  protected readonly statusOptions = [
    { label: '全部狀態', value: null },
    { label: PARENT_STATUS_LABELS.active, value: 'active' as ParentStatus },
    { label: PARENT_STATUS_LABELS.inactive, value: 'inactive' as ParentStatus },
    { label: PARENT_STATUS_LABELS.archived, value: 'archived' as ParentStatus },
  ];

  protected readonly activeCount = computed(() => this.summary().activeCount);
  protected readonly inactiveCount = computed(() => this.summary().inactiveCount);

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedParent = signal<Parent | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const parent = this.selectedParent();
    if (!parent) return [];
    const items: MenuItem[] = [
      {
        label: '查看詳情',
        icon: 'pi pi-user',
        command: () => this.openDetailDialog(parent),
      },
      {
        label: '新增學生',
        icon: 'pi pi-user-plus',
        disabled: parent.status === 'archived',
        command: () => this.openAddStudentDialog(parent),
      },
      {
        label: '編輯',
        icon: 'pi pi-pencil',
        disabled: parent.status === 'archived',
        command: () => this.openEditDialog(parent),
      },
      {
        label: '產生登入連結',
        icon: 'pi pi-qrcode',
        disabled: parent.status === 'archived',
        command: () => this.issueLoginLink(parent),
      },
      { separator: true },
    ];
    if (parent.status === 'active') {
      items.push({
        label: '停用帳號',
        icon: 'pi pi-lock',
        command: () => this.confirmDeactivate(parent),
      });
    } else if (parent.status === 'inactive') {
      items.push({
        label: '啟用帳號',
        icon: 'pi pi-unlock',
        command: () => this.confirmActivate(parent),
      });
    }
    if (parent.status !== 'archived') {
      items.push({
        label: '封存帳號',
        icon: 'pi pi-inbox',
        command: () => this.confirmArchive(parent),
      });
    }
    return items;
  });

  protected openActionMenu(event: MouseEvent, parent: Parent): void {
    this.selectedParent.set(parent);
    this.actionMenu().toggle(event);
  }

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.total(),
  }));

  ngOnInit(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.loadParents();
      });
    this.loadParents();
  }

  protected loadParents(): void {
    this.loading.set(true);
    this.parentsService
      .list({
        search: this.searchQuery() || undefined,
        status: this.selectedStatus() ?? undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.parents.set(res.data);
          this.total.set(res.meta.total);
          this.summary.set(res.summary);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入家長列表',
          });
          this.loading.set(false);
        },
      });
  }

  protected onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  protected onStatusChange(status: ParentStatus | null): void {
    this.selectedStatus.set(status);
    this.currentPage.set(1);
    this.loadParents();
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.loadParents();
  }

  protected getStatusLabel(status: ParentStatus): string {
    return PARENT_STATUS_LABELS[status] ?? status;
  }

  protected getStatusSeverity(status: ParentStatus): 'success' | 'secondary' | 'danger' {
    if (status === 'active') return 'success';
    if (status === 'inactive') return 'secondary';
    return 'danger';
  }

  protected getPersonHue(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) & 0xfffffff;
    }
    const raw = hash % 320;
    return raw < 45 ? raw + 160 : raw;
  }

  // ── Create / Edit ──────────────────────────────────────────────────────────

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(ParentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { parent: null },
    });

    if (!ref) return;
    ref.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result?: { type: string; data: Parent; loginUrl: string }) => {
        if (!result) return;
        if (result.type === 'created') {
          this.loadParents();
          this.openLoginLinkDialog(result.data, result.loginUrl);
        }
      });
  }

  protected openImportDialog(): void {
    const ref = this.dialogService.open(ParentImportDialogComponent, {
      header: '批次匯入家長',
      width: '720px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
    });
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result === 'imported') this.loadParents();
    });
  }

  protected openEditDialog(parent: Parent): void {
    // Load full detail first then open dialog
    this.parentsService.get(parent.id).subscribe({
      next: (res) => {
        const ref = this.dialogService.open(ParentFormDialogComponent, {
          width: '560px',
          modal: true,
          showHeader: false,
          appendTo: this.overlayContainer || 'body',
          data: { parent: res.data },
        });

        if (!ref) return;
        ref.onClose
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result?: { type: string }) => {
            if (result?.type === 'updated') this.loadParents();
          });
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入家長資料',
        });
      },
    });
  }

  protected openAddStudentDialog(parent: Parent): void {
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student: null, parentId: parent.id },
    });

    if (!ref) return;
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) {
        this.messageService.add({
          severity: 'success',
          summary: '學生已建立',
          detail: `「${result.name}」已建立並關聯至「${parent.name}」`,
        });
        this.loadParents();
      }
    });
  }

  protected openDetailDialog(parent: Parent): void {
    this.dialogService.open(ParentDetailDialogComponent, {
      header: parent.name,
      width: '480px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data: { parentId: parent.id },
    });
  }

  private openLoginLinkDialog(parent: Parent, loginUrl: string): void {
    this.dialogService.open(LoginLinkDialogComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { loginUrl, personName: parent.name },
    });
  }

  // ── 登入連結 ───────────────────────────────────────────────────────────────
  //
  // 取代原本的「重設密碼」。這個系統沒有密碼了 —— 家長用一次性連結登入、綁定 LINE，
  // 之後直接用 LINE。連結會過期、只能用一次；密碼會被寫在便條紙上留著。

  protected issueLoginLink(parent: Parent): void {
    if (!parent.userId) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法產生',
        detail: '這位家長還沒有帳號，無法產生連結',
      });
      return;
    }

    this.parentsService.createLoginLink(parent.userId).subscribe({
      next: (res) => this.openLoginLinkDialog(parent, res.url),
      error: () => {
        this.messageService.add({ severity: 'error', summary: '產生失敗', detail: '請稍後再試' });
      },
    });
  }

  // ── Status Operations ──────────────────────────────────────────────────────

  protected confirmDeactivate(parent: Parent): void {
    this.openConfirmDialog(
      '停用家長帳號',
      {
        message: `確定要停用「${parent.name}」嗎？停用後該家長將無法登入系統。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => this.changeStatus(parent, 'deactivate', '已停用'),
    );
  }

  protected confirmActivate(parent: Parent): void {
    this.openConfirmDialog(
      '啟用家長帳號',
      {
        message: `確定要啟用「${parent.name}」嗎？`,
        acceptLabel: '啟用',
        rejectLabel: '取消',
        acceptSeverity: 'success',
      },
      () => this.changeStatus(parent, 'activate', '已啟用'),
    );
  }

  protected confirmArchive(parent: Parent): void {
    this.openConfirmDialog(
      '封存家長帳號',
      {
        message: `封存後無法透過系統自動復原。確定要封存「${parent.name}」的帳號嗎？`,
        acceptLabel: '封存',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.changeStatus(parent, 'archive', '已封存'),
    );
  }

  private changeStatus(
    parent: Parent,
    action: 'activate' | 'deactivate' | 'archive',
    successMsg: string,
  ): void {
    const req =
      action === 'activate'
        ? this.parentsService.activate(parent.id)
        : action === 'deactivate'
          ? this.parentsService.deactivate(parent.id)
          : this.parentsService.archive(parent.id);

    req.subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: successMsg,
          detail: `「${parent.name}」${successMsg}`,
        });
        this.loadParents();
      },
      error: (err) => {
        const detail =
          err.error?.error === 'ALREADY_ARCHIVED' ? '帳號已封存，無法再次操作' : '請稍後再試';
        this.messageService.add({ severity: 'error', summary: '操作失敗', detail });
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) onAccept();
    });
  }
}
