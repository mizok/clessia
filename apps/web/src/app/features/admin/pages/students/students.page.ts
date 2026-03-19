import { Component, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { Menu } from 'primeng/menu';
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
import {
  StudentsService,
  Student,
  StudentListResponse,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';

// Local
import { StudentFormDialogComponent } from './student-form-dialog.component';

@Component({
  selector: 'app-students',
  standalone: true,
  imports: [
    CommonModule,
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
    MenuModule,
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
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // State
  readonly students = signal<Student[]>([]);
  readonly loading = signal(true);
  readonly searchQuery = signal('');
  readonly selectedGrade = signal<GradeLevel | null>(null);
  readonly summary = signal({ total: 0, activeCount: 0 });
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);
  protected readonly showInactiveStudents = signal(false);
  protected readonly PAGE_SIZE = 20;

  // Grade options for dropdown
  protected readonly gradeOptions = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];

  // Computed
  readonly activeStudentCount = computed(() => this.summary().activeCount);
  readonly inactiveStudentCount = computed(
    () => this.summary().total - this.summary().activeCount,
  );

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
    rows: this.PAGE_SIZE,
    totalRecords: this.total(),
  }));

  // Action menu
  protected readonly actionMenu = viewChild.required<Menu>('actionMenu');
  protected readonly selectedStudent = signal<Student | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const student = this.selectedStudent();
    if (!student) return [];
    return [
      { label: '查看詳情', icon: 'pi pi-eye', routerLink: [RoutesCatalog.ADMIN_STUDENTS.absolutePath, student.id] },
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openEditDialog(student) },
      ...(student.isActive
        ? [{ separator: true }, { label: '停用', icon: 'pi pi-lock', command: () => this.confirmDeactivate(student) }]
        : []
      ),
    ];
  });

  protected openActionMenu(event: MouseEvent, student: Student): void {
    this.selectedStudent.set(student);
    this.actionMenu().toggle(event);
  }

  ngOnInit(): void {
    this.loadStudents();
  }

  loadStudents(): void {
    this.loading.set(true);
    this.studentsService
      .list({
        search: this.searchQuery() || undefined,
        grade: this.selectedGrade() ?? undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
        isActive: this.showInactiveStudents() ? undefined : true,
      })
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
    this.searchQuery.set(value);
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onGradeChange(grade: GradeLevel | null): void {
    this.selectedGrade.set(grade);
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onPage(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(event.page + 1);
    this.loadStudents();
  }

  protected toggleShowInactiveStudents(): void {
    this.showInactiveStudents.set(!this.showInactiveStudents());
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected getGradeLabel(grade: GradeLevel): string {
    return GRADE_LEVEL_LABELS[grade] ?? grade;
  }

  protected navigateToDetail(student: Student): void {
    this.router.navigate([RoutesCatalog.ADMIN_STUDENTS.absolutePath, student.id]);
  }

  openEditDialog(student: Student): void {
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      header: '編輯學生',
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

  private deactivateStudent(student: Student): void {
    this.studentsService.deactivate(student.id).subscribe({
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
