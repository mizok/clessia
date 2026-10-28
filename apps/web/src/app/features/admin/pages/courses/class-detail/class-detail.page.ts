import { ReloadVeilComponent } from '@shared/components/reload-veil/reload-veil.component';
import { injectOptimisticRemove } from '@shared/utils/optimistic-remove.util';
import { injectViewTransition } from '@shared/utils/view-transition.util';
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ClassesService, Class, type Schedule } from '@core/classes.service';
import { taipeiDateString } from '@core/system-clock.service';
import { effectiveRangeLabel } from '@shared/utils/schedule-effective.util';
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
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { StudentPickerDialogComponent } from './student-picker-dialog/student-picker-dialog.component';
import { CopyRosterDialogComponent } from './copy-roster-dialog/copy-roster-dialog.component';
import { RosterImportDialogComponent } from './roster-import-dialog/roster-import-dialog.component';
import { EnrollmentBillingDialogComponent } from './enrollment-billing-dialog/enrollment-billing-dialog.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [
    SkeletonComponent,
    ReloadVeilComponent,
    PageOpenComponent,
    RouterLink,
    PopupMenuComponent,
    LoadFailedComponent,
  ],
  providers: [DialogService],
  templateUrl: './class-detail.page.html',
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
  /** 重抓的名冊平滑換上；增刪造成的重抓帶 rows，那一列淡入或淡出（#1641 5b） */
  private readonly viewTransition = injectViewTransition();
  private readonly optimisticRemove = injectOptimisticRemove();

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

  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly loading = signal(true);
  /** #998：取數失敗要有自己的畫面（同課程列表 #795）—— toast 幾秒就消失，之後只剩麵包屑 */
  protected readonly loadFailed = signal(false);
  protected readonly enrollmentsLoading = signal(true);

  protected readonly statusLabels = ENROLLMENT_STATUS_LABELS;
  /** 學生名單｜課表（A6 灰工具列上的兩個分頁） */
  protected readonly tab = signal<'roster' | 'schedule'>('roster');

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
        label: '恢復在學',
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
      // 計費模式是**報名層級**的選擇（billing-rules 規則 1），所以它的家在單筆名單上，
      // 不在班級設定裡 —— 同一班可以同時有月繳生與期繳生
      items.push({
        label: '計費設定',
        icon: 'pi pi-wallet',
        command: () => this.openBillingDialog(e),
      });
      items.push({ separator: true });
      if (e.attendanceCount === 0) {
        items.push({
          label: '移除',
          icon: 'pi pi-trash',
          danger: true,
          command: () => this.confirmRemove(e),
        });
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

    this.loading.set(true);
    this.loadFailed.set(false);
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
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  /**
   * `quiet`：移除成功後的背景重抓 —— 畫面已經是「移掉了」，不再變淡（#1641 5b 第 1 點）。
   * `rows`：加入／複製／匯入／退班造成的重抓，回應套上時那一列淡入或淡出。
   */
  protected loadEnrollments({
    quiet = false,
    rows = false,
  }: { quiet?: boolean; rows?: boolean } = {}): void {
    const classId = this.resolvedClassId();
    if (!classId) {
      this.enrollmentsLoading.set(false);
      return;
    }

    if (!quiet) this.enrollmentsLoading.set(true);
    this.enrollmentsService
      .list({ classId, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.viewTransition(
            () => {
              this.enrollments.set(
                res.data.filter((e) => e.status !== 'withdrawal' && e.status !== 'void'),
              );
              this.enrollmentsLoading.set(false);
            },
            { rows },
          );
        },
        error: () => this.enrollmentsLoading.set(false),
      });
  }

  protected openActionMenu(event: MouseEvent, enrollment: Enrollment): void {
    this.selectedEnrollment.set(enrollment);
    this.actionMenu().toggle(event);
  }

  protected openBillingDialog(enrollment: Enrollment): void {
    const ref = this.dialogService.open(EnrollmentBillingDialogComponent, {
      width: '460px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { enrollment },
    });
    ref?.onClose.subscribe((saved) => {
      if (saved) this.loadEnrollments({ rows: true });
    });
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
        this.loadEnrollments({ rows: true });
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
      if (result === 'copied') this.loadEnrollments({ rows: true });
    });
  }

  protected openRosterImport(): void {
    const cls = this.cls();
    if (!cls) return;

    const ref = this.dialogService.open(RosterImportDialogComponent, {
      header: '從 Excel 匯入名單',
      width: '640px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: { classId: cls.id },
    });

    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result === 'imported') this.loadEnrollments({ rows: true });
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
          this.loadEnrollments({ rows: true });
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
        // #999：原本寫「此操作不留紀錄」—— 刪除報名在後端會寫 audit_logs（#851），那半句是錯的
        message: `確定要移除「${enrollment.studentName}」？移除後無法復原（操作紀錄會保留）。`,
        acceptLabel: '移除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      // 樂觀移除（#1641 5b 第 1 點）：只有出勤 0 筆才給移除，被擋下的情況少見；失敗放回並說明
      () =>
        this.optimisticRemove(
          this.enrollments,
          (e) => e.id === enrollment.id,
          this.enrollmentsService.delete(enrollment.id).pipe(takeUntilDestroyed(this.destroyRef)),
          {
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: '已移除',
                detail: `「${enrollment.studentName}」已從班級移除`,
              });
              this.loadEnrollments({ quiet: true, rows: true });
            },
            error: (err: any) => {
              const code = err.error?.error;
              const detail =
                code === 'has_attendance' ? '此學生已有出勤紀錄，請改用退班流程' : '請稍後再試';
              this.messageService.add({ severity: 'error', summary: '移除失敗', detail });
            },
          },
        ),
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

  private readonly today = taipeiDateString(Date.now());
  /** 色面「N 個上課時段」算今天有效的（#1100 #22：舊段與新段前後接續，不能兩個都算） */
  protected readonly activeScheduleCount = computed(
    () =>
      (this.cls()?.schedules ?? []).filter(
        (s) =>
          s.effectiveFrom <= this.today && (s.effectiveTo === null || s.effectiveTo >= this.today),
      ).length,
  );
  /** 時段列標區間；已結束的段整列淡掉 */
  protected scheduleRange(s: Schedule): string {
    return effectiveRangeLabel(s.effectiveFrom, s.effectiveTo, this.today);
  }
  protected isScheduleEnded(s: Schedule): boolean {
    return s.effectiveTo !== null && s.effectiveTo < this.today;
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  protected navigateToStudent(studentId: string): void {
    this.router.navigate(['/admin/students', studentId]);
  }
}
