import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ToastModule } from 'primeng/toast';
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
import {
  StudentsService,
  Student,
  StudentListResponse,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PageBandComponent } from '@shared/components/page-band/page-band.component';
import { BandAnchorComponent } from '@shared/components/page-band/band-anchor/band-anchor.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';

// Local
import { StudentFormDialogComponent } from './student-form-dialog.component';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import { personHue } from '@shared/utils/person-hue.util';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';

@Component({
  selector: 'app-students',
  standalone: true,
  imports: [
    StatusDotComponent,
    PageBandComponent,
    BandAnchorComponent,
    PageActionsComponent,
    CommonModule,
    FormsModule,
    ButtonModule,
    InputIconModule,
    IconFieldModule,
    ToastModule,
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
  templateUrl: './students.page.html',
  styleUrl: './students.page.scss',
})
export class StudentsPage implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly studentsService = inject(StudentsService);

  /** 搜尋輸入 —— 節流 + 去重之後才進 `loadStudents()`（#659） */
  private readonly searchInput = new Subject<string>();
  /**
   * **所有**取數都經過這裡，然後 `switchMap` 出去。
   *
   * `debounce` 只解一半：打字慢的人（每次間隔超過 300ms）仍然會送出多支請求，
   * 而它們回來的順序不保證 —— **先發的後到就會蓋掉畫面**，而畫面上的輸入框
   * 顯示的是最新的字。使用者看到「陳小華」配「陳」的結果，
   * 而且**它不會自己追上**（沒有任何後續事件會重查）。
   *
   * 讓每一個取數都走同一條 `switchMap`，新的一發就取消舊的那一支。
   */
  private readonly loadRequests = new Subject<void>();
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  readonly page = input.required<RouteObj>();
  // State
  readonly students = signal<Student[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly selectedGrade = signal<GradeLevel | null>(null);
  readonly summary = signal({ total: 0, activeCount: 0 });
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);
  protected readonly statusFilter = signal<boolean | null>(null);
  protected readonly PAGE_SIZE = LIST_PAGE_SIZE;

  // Grade options for dropdown
  protected readonly gradeOptions = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  protected readonly statusOptions = [
    { label: '啟用中', value: true },
    { label: '已停用', value: false },
  ];

  // Computed
  readonly activeStudentCount = computed(() => this.summary().activeCount);
  readonly inactiveStudentCount = computed(() => this.summary().total - this.summary().activeCount);

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.total(),
  }));

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedStudent = signal<Student | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const student = this.selectedStudent();
    if (!student) return [];
    return [
      {
        label: '學生詳情',
        icon: 'pi pi-arrow-right',
        command: () => this.navigateToDetail(student),
      },
      { separator: true },
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openEditDialog(student) },
      ...(student.isActive
        ? [
            { separator: true },
            { label: '停用', icon: 'pi pi-lock', command: () => this.confirmDeactivate(student) },
          ]
        : []),
      { separator: true },
      {
        label: student.hasEnrollments ? '已有報名紀錄，無法刪除' : '刪除學生',
        icon: 'pi pi-trash',
        disabled: student.hasEnrollments,
        styleClass: student.hasEnrollments ? '' : 'text-red-500',
        command: () => this.confirmDelete(student),
      },
    ];
  });

  protected openActionMenu(event: MouseEvent, student: Student): void {
    this.selectedStudent.set(student);
    this.actionMenu().toggle(event);
  }

  ngOnInit(): void {
    this.setupLoadPipeline();

    // 搜尋：節流 + 去重，然後才觸發取數。
    // `distinctUntilChanged` 擋的是「同一個字重複送」——例如中文輸入法組字過程中
    // 送出同樣的中間值，或使用者貼上同樣的內容。
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.loadStudents();
      });

    this.loadStudents();
  }

  /** 觸發取數。實際的請求在 `ngOnInit` 的那條 `switchMap` 管線裡（#659） */
  loadStudents(): void {
    this.loading.set(true);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.loadRequests
      .pipe(
        switchMap(() =>
          this.studentsService.list({
            search: this.searchQuery() || undefined,
            grade: this.selectedGrade() ?? undefined,
            page: this.currentPage(),
            pageSize: this.PAGE_SIZE,
            isActive: this.statusFilter() ?? undefined,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res: StudentListResponse) => {
          this.students.set(res.data);
          this.total.set(res.meta.total);
          this.summary.set(res.summary);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Failed to load students', err);
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入學生列表',
          });
          this.loading.set(false);
        },
      });
  }

  protected onSearchChange(value: string): void {
    this.searchInput.next(value);
  }

  protected onGradeChange(grade: GradeLevel | null): void {
    this.selectedGrade.set(grade);
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onStatusFilterChange(value: boolean | null): void {
    this.statusFilter.set(value);
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.loadStudents();
  }

  protected getGradeLabel(grade: GradeLevel): string {
    return GRADE_LEVEL_LABELS[grade] ?? grade;
  }

  /** 見 `personHue` —— 契約是「同一個人到哪一頁都同色」，所以只能有一份實作 */
  protected getPersonHue(id: string): number {
    return personHue(id);
  }

  protected navigateToDetail(student: Student): void {
    this.router.navigate([RoutesCatalog.ADMIN_STUDENTS.absolutePath, student.id]);
  }

  protected readonly primaryAction: PageAction = { label: '新增學生', icon: 'pi pi-plus' };

  openEditDialog(student: Student): void {
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student },
    });

    if (ref) {
      ref.onClose.subscribe((updatedStudent) => {
        if (updatedStudent) this.loadStudents();
      });
    }
  }

  /**
   * `StudentFormDialogComponent` 早就有建立模式（`isCreateMode()`），但這一頁
   * 從來沒有入口叫得到它——`kb/wiki/specs/admin/student-affairs/students.md`
   * 明寫「待實作：手動新增學生功能尚未完成」。這支只是接線，不是新設計。
   */
  openCreateDialog(): void {
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student: null },
    });

    if (!ref) return;
    ref.onClose.subscribe((createdStudent) => {
      if (!createdStudent) return;
      this.messageService.add({
        severity: 'success',
        summary: '已建立',
        detail: `「${createdStudent.name}」已建立`,
      });
      this.loadStudents();
    });
  }

  confirmDeactivate(student: Student): void {
    this.openConfirmDialog(
      '確認停用',
      {
        message: `確定要停用「${student.name}」嗎？停用後該學生將不會出現在預設篩選結果中。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => this.deactivateStudent(student),
    );
  }

  confirmDelete(student: Student): void {
    if (student.hasEnrollments) return;
    this.openConfirmDialog(
      '確認刪除',
      {
        message: `確定要刪除「${student.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.deleteStudent(student),
    );
  }

  private deleteStudent(student: Student): void {
    this.studentsService.delete(student.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已刪除',
          detail: `「${student.name}」已刪除`,
        });
        this.loadStudents();
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private deactivateStudent(student: Student): void {
    this.studentsService.delete(student.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已停用',
          detail: `「${student.name}」已停用`,
        });
        this.loadStudents();
      },
      error: (err) => {
        console.error('Failed to deactivate student', err);
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
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
}
