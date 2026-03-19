import { Component, OnInit, inject, signal, computed, DestroyRef, input, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TabsModule } from 'primeng/tabs';
import { MenuModule } from 'primeng/menu';
import { Menu } from 'primeng/menu';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';
import {
  EnrollmentsService,
  Enrollment,
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
} from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';
import { StudentPickerDialogComponent } from './student-picker-dialog/student-picker-dialog.component';
import type { Student } from '@core/students.service';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [ButtonModule, TagModule, ToastModule, TabsModule, MenuModule, SkeletonModule],
  providers: [MessageService, DialogService],
  templateUrl: './class-detail.page.html',
  styleUrl: './class-detail.page.scss',
})
export class ClassDetailPage implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input.required<RouteObj>();
  readonly courseId = input.required<string>();
  readonly classId = input.required<string>();

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected readonly cls = signal<Class | null>(null);
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly loading = signal(true);
  protected readonly enrollmentsLoading = signal(true);

  protected readonly statusLabels = ENROLLMENT_STATUS_LABELS;

  protected readonly actionMenu = viewChild.required<Menu>('actionMenu');
  protected readonly selectedEnrollment = signal<Enrollment | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const e = this.selectedEnrollment();
    if (!e) return [];
    const items: MenuItem[] = [];
    if (e.status === 'active') {
      items.push({ label: '停權', icon: 'pi pi-lock', command: () => this.confirmSuspend(e) });
    }
    if (e.status === 'suspended') {
      items.push({ label: '恢復在籍', icon: 'pi pi-unlock', command: () => this.changeStatus(e, 'active') });
    }
    if (e.status === 'pending_payment') {
      items.push({ label: '確認收款', icon: 'pi pi-check', command: () => this.changeStatus(e, 'active') });
      items.push({ label: '刪除', icon: 'pi pi-trash', command: () => this.confirmDelete(e) });
    }
    if (!['withdrawal', 'void'].includes(e.status)) {
      items.push({ separator: true });
      items.push({ label: '退班', icon: 'pi pi-sign-out', command: () => this.confirmWithdrawal(e) });
    }
    return items;
  });

  ngOnInit(): void {
    this.loadClass();
    this.loadEnrollments();
  }

  protected loadClass(): void {
    this.classesService
      .get(this.classId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.cls.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '載入失敗', detail: '無法載入班級資料' });
          this.loading.set(false);
        },
      });
  }

  protected loadEnrollments(): void {
    this.enrollmentsLoading.set(true);
    this.enrollmentsService
      .list({ classId: this.classId(), pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.enrollments.set(res.data);
          this.enrollmentsLoading.set(false);
        },
        error: () => this.enrollmentsLoading.set(false),
      });
  }

  protected openActionMenu(event: MouseEvent, enrollment: Enrollment): void {
    this.selectedEnrollment.set(enrollment);
    this.actionMenu().toggle(event);
  }

  protected openStudentPicker(): void {
    const existingStudentIds = this.enrollments()
      .filter((e) => !['withdrawal', 'void'].includes(e.status))
      .map((e) => e.studentId);

    const ref = this.dialogService.open(StudentPickerDialogComponent, {
      header: '選擇學生',
      width: '560px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: { existingStudentIds },
    });

    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((student?: Student) => {
      if (!student) return;
      this.addStudent(student);
    });
  }

  private addStudent(student: Student): void {
    const activeCount = this.enrollments().filter((e) =>
      ['active', 'pending_payment'].includes(e.status),
    ).length;
    const maxStudents = this.cls()?.maxStudents ?? 0;

    this.enrollmentsService
      .create({ classId: this.classId(), studentId: student.id, status: 'active' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (activeCount >= maxStudents) {
            this.messageService.add({
              severity: 'warn',
              summary: '已超過人數上限',
              detail: `班級人數已達 ${maxStudents} 人，已超額加入`,
            });
          } else {
            this.messageService.add({
              severity: 'success',
              summary: '已加入',
              detail: `「${student.name}」已加入班級`,
            });
          }
          this.loadEnrollments();
        },
        error: (err) => {
          const code = err.error?.error;
          const detail = code === 'ALREADY_ENROLLED' ? '該學生已在此班' : '請稍後再試';
          this.messageService.add({ severity: 'error', summary: '加入失敗', detail });
        },
      });
  }

  protected changeStatus(enrollment: Enrollment, status: EnrollmentStatus, notes?: string): void {
    this.enrollmentsService
      .updateStatus(enrollment.id, status, notes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '狀態已更新',
            detail: ENROLLMENT_STATUS_LABELS[status],
          });
          this.loadEnrollments();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '更新失敗', detail: '請稍後再試' });
        },
      });
  }

  private confirmSuspend(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '停權',
      {
        message: `確定要停權「${enrollment.studentName}」嗎？請填寫停權原因。`,
        acceptLabel: '停權',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
        requireNotes: true,
      },
      (notes) => this.changeStatus(enrollment, 'suspended', notes),
    );
  }

  private confirmWithdrawal(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '退班',
      {
        message: `確定要讓「${enrollment.studentName}」退班嗎？`,
        acceptLabel: '退班',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
        requireNotes: true,
      },
      (notes) => this.changeStatus(enrollment, 'withdrawal', notes),
    );
  }

  private confirmDelete(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '刪除報名',
      {
        message: `確定要刪除「${enrollment.studentName}」的報名記錄嗎？`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.enrollmentsService
          .delete(enrollment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: '已刪除' });
              this.loadEnrollments();
            },
          });
      },
    );
  }

  private openConfirmDialog(
    header: string,
    data: ConfirmDialogData,
    onAccept: (notes?: string) => void,
  ): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) onAccept(typeof result === 'object' ? result.notes : undefined);
    });
  }

  protected getStatusSeverity(
    status: EnrollmentStatus,
  ): 'success' | 'warn' | 'secondary' | 'danger' {
    if (status === 'active') return 'success';
    if (status === 'pending_payment') return 'warn';
    if (status === 'suspended') return 'secondary';
    return 'danger';
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  protected goBack(): void {
    this.router.navigate(['/admin/courses']);
  }
}
