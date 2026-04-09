import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
  input,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TabsModule } from 'primeng/tabs';
import type { TabListPassThrough } from 'primeng/types/tabs';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';
import { PageBreadcrumbComponent, type BreadcrumbItem } from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
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
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { StudentPickerDialogComponent } from './student-picker-dialog/student-picker-dialog.component';
import { CopyRosterDialogComponent } from './copy-roster-dialog/copy-roster-dialog.component';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [
    ButtonModule,
    TagModule,
    ToastModule,
    TabsModule,
    SkeletonModule,
    PageBreadcrumbComponent,
    PopupMenuComponent,
  ],
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
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input<RouteObj | undefined>();
  readonly courseId = input<string | undefined>();
  readonly classId = input<string | undefined>();

  private readonly resolvedCourseId = computed(
    () => this.courseId() ?? this.route.snapshot.paramMap.get('courseId') ?? '',
  );
  private readonly resolvedClassId = computed(
    () => this.classId() ?? this.route.snapshot.paramMap.get('classId') ?? '',
  );

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected readonly cls = signal<Class | null>(null);

  protected readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const c = this.cls();
    return [
      { label: '課務管理' },
      { label: '課程', routerLink: '/admin/courses' },
      { label: c?.courseName ?? '...', routerLink: c ? `/admin/courses/${c.courseId}` : undefined },
      { label: c?.name ?? '...' },
    ];
  });
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly loading = signal(true);
  protected readonly enrollmentsLoading = signal(true);

  protected readonly statusLabels = ENROLLMENT_STATUS_LABELS;
  protected readonly tabListPt: TabListPassThrough = {
    tabList: {
      style: {
        padding: '0 var(--space-5)',
        alignItems: 'center',
      },
    },
  };

  /** 用 courseId + classId 決定性地 hash 出一個色相值（0–359） */
  protected readonly avatarHue = computed(() => {
    const seed = this.resolvedCourseId() + this.resolvedClassId();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) & 0xfffffff;
    }
    // 跳過偏黃區間（45–65°），那個範圍白字對比太差
    const raw = hash % 320;
    return raw < 45 ? raw : raw + 20;
  });

  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedEnrollment = signal<Enrollment | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const e = this.selectedEnrollment();
    if (!e) return [];
    const items: MenuItem[] = [];

    if (e.status === 'active') {
      items.push({ label: '停權', icon: 'pi pi-lock', command: () => this.confirmSuspend(e) });
    }
    if (e.status === 'suspended') {
      items.push({
        label: '恢復在籍',
        icon: 'pi pi-unlock',
        command: () => this.changeStatus(e, 'active'),
      });
    }
    if (e.status === 'pending_payment') {
      items.push({
        label: '確認收款',
        icon: 'pi pi-check',
        command: () => this.changeStatus(e, 'active'),
      });
    }

    if (!['withdrawal', 'void'].includes(e.status)) {
      items.push({ separator: true });
      if (e.attendanceCount === 0) {
        items.push({ label: '移除', icon: 'pi pi-trash', command: () => this.confirmRemove(e) });
      } else {
        items.push({
          label: '退班',
          icon: 'pi pi-sign-out',
          command: () => this.confirmWithdrawal(e),
        });
      }
    }

    return items;
  });

  ngOnInit(): void {
    this.loadClass();
    this.loadEnrollments();
  }

  protected loadClass(): void {
    const classId = this.resolvedClassId();
    if (!classId) {
      this.loading.set(false);
      return;
    }

    this.classesService
      .get(classId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.cls.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入班級資料',
          });
          this.loading.set(false);
        },
      });
  }

  protected loadEnrollments(): void {
    const classId = this.resolvedClassId();
    if (!classId) {
      this.enrollmentsLoading.set(false);
      return;
    }

    this.enrollmentsLoading.set(true);
    this.enrollmentsService
      .list({ classId, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.enrollments.set(
            res.data.filter((e) => e.status !== 'withdrawal' && e.status !== 'void'),
          );
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

    const currentActiveCount = this.enrollments().filter((e) =>
      ['active', 'pending_payment'].includes(e.status),
    ).length;

    const ref = this.dialogService.open(StudentPickerDialogComponent, {
      header: '選擇學生',
      width: '560px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: {
        existingStudentIds,
        maxStudents: this.cls()?.maxStudents ?? 9999,
        currentActiveCount,
        classId: this.resolvedClassId(),
      },
    });

    ref?.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res?: { results: { studentId: string; status: string }[] }) => {
        if (!res?.results?.length) return;
        const enrolled = res.results.filter((r) => r.status === 'enrolled').length;
        const alreadyExists = res.results.filter((r) => r.status === 'already_exists').length;
        const errors = res.results.filter((r) => r.status === 'error').length;

        const parts: string[] = [];
        if (enrolled > 0) parts.push(`成功加入 ${enrolled} 人`);
        if (alreadyExists > 0) parts.push(`${alreadyExists} 人已在班（略過）`);
        if (errors > 0) parts.push(`${errors} 人失敗`);

        this.messageService.add({
          severity: errors > 0 ? 'warn' : 'success',
          summary: '加入完成',
          detail: parts.join('，'),
        });
        this.loadEnrollments();
      });
  }

  protected openCopyRoster(): void {
    const cls = this.cls();
    if (!cls) return;

    const ref = this.dialogService.open(CopyRosterDialogComponent, {
      header: '從既有班級複製名單',
      width: '480px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: { classId: cls.id, campusId: cls.campusId, campusName: cls.campusName },
    });

    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result === 'copied') this.loadEnrollments();
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

  private confirmRemove(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '移除學生',
      {
        message: `確定要移除「${enrollment.studentName}」？此操作不留紀錄，無法復原。`,
        acceptLabel: '移除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.enrollmentsService
          .delete(enrollment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: '已移除',
                detail: `「${enrollment.studentName}」已從班級移除`,
              });
              this.loadEnrollments();
            },
            error: (err) => {
              const code = err.error?.error;
              const detail =
                code === 'has_attendance' ? '此學生已有出勤紀錄，請改用退班流程' : '請稍後再試';
              this.messageService.add({ severity: 'error', summary: '移除失敗', detail });
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
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) onAccept(typeof result === 'object' ? result.notes : undefined);
    });
  }

  protected getStudentHue(studentId: string): number {
    let hash = 0;
    for (let i = 0; i < studentId.length; i++) {
      hash = (hash * 31 + studentId.charCodeAt(i)) & 0xfffffff;
    }
    const raw = hash % 320;
    return raw < 45 ? raw + 160 : raw;
  }

  protected getStatusSeverity(
    status: EnrollmentStatus,
  ): 'success' | 'warn' | 'secondary' | 'danger' {
    if (status === 'active') return 'success';
    if (status === 'pending_payment') return 'warn';
    if (status === 'suspended') return 'secondary';
    return 'danger';
  }

  protected getGradeLabel(grade: string): string {
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  protected navigateToStudent(studentId: string): void {
    this.router.navigate(['/admin/students', studentId]);
  }

  protected goBack(): void {
    this.router.navigate(['/admin/courses']);
  }
}
