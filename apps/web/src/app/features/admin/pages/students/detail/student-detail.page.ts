import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { DialogService } from 'primeng/dynamicdialog';

import {
  StudentsService,
  StudentDetail,
  GradeLevel,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import {
  EnrollmentsService,
  Enrollment,
  ENROLLMENT_STATUS_LABELS,
  ScheduleConflictWarning,
  type EnrollmentStatus,
} from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  PageBreadcrumbComponent,
  type BreadcrumbItem,
} from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { ClassPickerDialogComponent } from '@shared/components/class-picker-dialog/class-picker-dialog.component';
import {
  InlineNoticeComponent,
  type InlineNoticeSeverity,
} from '@shared/components/inline-notice/inline-notice.component';
import { StudentFormDialogComponent } from '../student-form-dialog.component';
import type { Class } from '@core/classes.service';
import { DataChipComponent } from '@shared/components/status/data-chip/data-chip.component';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';
import { personHue } from '@shared/utils/person-hue.util';
import { EnrollmentBillingDialogComponent } from '../../courses/class-detail/enrollment-billing-dialog/enrollment-billing-dialog.component';

interface InlineNoticeState {
  readonly severity: InlineNoticeSeverity;
  readonly summary: string;
  readonly detail: string;
}

interface ConflictPrompt {
  readonly cls: Class;
  readonly warnings: readonly ScheduleConflictWarning[];
}

@Component({
  selector: 'app-student-detail',
  standalone: true,
  imports: [
    StatusDotComponent,
    DataChipComponent,
    CommonModule,
    ButtonModule,
    SkeletonModule,
    EmptyStateComponent,
    PageBreadcrumbComponent,
    InlineNoticeComponent,
  ],
  providers: [DialogService],
  templateUrl: './student-detail.page.html',
  styleUrl: './student-detail.page.scss',
})
export class StudentDetailPage implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  readonly student = signal<StudentDetail | null>(null);

  protected readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const s = this.student();
    return [
      { label: '學務管理' },
      { label: '學生', routerLink: '/admin/students' },
      { label: s?.name ?? '...' },
    ];
  });
  readonly loading = signal(true);
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly enrollmentsLoading = signal(false);
  protected readonly notice = signal<InlineNoticeState | null>(null);
  protected readonly conflictPrompt = signal<ConflictPrompt | null>(null);
  protected readonly enrollingClassId = signal<string | null>(null);
  protected readonly ENROLLMENT_STATUS_LABELS = ENROLLMENT_STATUS_LABELS;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.student.set(null);
        this.enrollments.set([]);
        this.loading.set(false);
        this.enrollmentsLoading.set(false);
        return;
      }

      this.loadStudent(id);
      this.loadEnrollments(id);
    });
  }

  protected getGradeLabel(grade: GradeLevel): string {
    return GRADE_LEVEL_LABELS[grade] ?? grade;
  }

  /** 見 `personHue` —— 契約是「同一個人到哪一頁都同色」，所以只能有一份實作 */
  protected getPersonHue(id: string): number {
    return personHue(id);
  }

  protected getGenderLabel(gender: string | null): string {
    if (!gender) return '未填寫';
    const map: Record<string, string> = {
      male: '男',
      female: '女',
      prefer_not_to_say: '不提供',
    };
    return map[gender] ?? gender;
  }

  protected goBack(): void {
    this.router.navigate([RoutesCatalog.ADMIN_STUDENTS.absolutePath]);
  }

  protected openEditDialog(): void {
    const s = this.student();
    if (!s) return;
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student: s },
    });
    if (ref) {
      ref.onClose.subscribe((updated) => {
        if (updated) {
          const id = this.route.snapshot.paramMap.get('id');
          if (id) this.loadStudent(id);
          this.notice.set({
            severity: 'success',
            summary: '更新成功',
            detail: `「${updated.name}」已更新`,
          });
        }
      });
    }
  }

  private loadStudent(id: string): void {
    this.loading.set(true);
    this.studentsService.get(id).subscribe({
      next: (res) => {
        this.student.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load student', err);
        this.notice.set({
          severity: 'error',
          summary: '載入失敗',
          detail: '無法載入學生資料',
        });
        this.loading.set(false);
      },
    });
  }

  protected navigateToClass(courseId: string, classId: string): void {
    this.router.navigate(['/admin/courses', courseId, 'classes', classId]);
  }

  protected openClassPicker(): void {
    const s = this.student();
    if (!s) return;
    const existingClassIds = this.enrollments().map((e) => e.classId);
    const ref = this.dialogService.open(ClassPickerDialogComponent, {
      header: '選擇班級',
      width: '520px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data: { existingClassIds, studentGrade: s.grade },
    });
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cls: Class | undefined) => {
      if (cls) this.addToClass(cls);
    });
  }

  /**
   * **「沒有計費模式」才是問題，「還沒開帳」不是。**（#638 裁定，billing-api 堅持）
   *
   * `enrollment-rules` 6.2 明寫管理員「決定是否立即開帳」—— **不開帳是合法的**。
   * 所以這裡只看 `billingMode === null`，**不看有沒有帳單**。
   *
   * 條件抓寬的代價很具體：行政每建一筆正常的延後開帳報名都會看到警告，
   * 而**每天早上紅一次的東西，一週內就會被學會忽略** —— 那時真正該看的那筆
   * 也一起被忽略了。
   *
   * **`session_pack` 不要標成異常**：它永遠不進月結 run（買包時才開帳），
   * 看起來很像「不會被收錢」，**但它是有模式的**。
   * 用 `billingMode === null` 這個條件天然排除它 —— 寫在這裡是因為
   * 下一個人很可能想「補一個 session_pack 的特判」，而那會是錯的。
   */
  protected needsBillingSetup(enrollment: Enrollment): boolean {
    return enrollment.billingMode === null;
  }

  /** 補設定計費 —— 重用班級頁那支對話框，它吃 `{ enrollment }` */
  protected openBillingSetup(event: Event, enrollment: Enrollment): void {
    // 整列是 role="button"（點了會導到班級），這顆在它裡面，要擋住冒泡
    event.stopPropagation();
    const ref = this.dialogService.open(EnrollmentBillingDialogComponent, {
      header: '計費設定',
      width: '480px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { enrollment },
    });
    // **對話框關閉時回的是更新後的 `Enrollment`，不是字串** —— 取消時回
    // `undefined`。所以判斷「有沒有存」看的是有沒有值，不是比對某個字面值
    // （我一開始寫成 `=== 'saved'`，開檔看了才發現契約不是那樣）。
    ref?.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated: Enrollment | undefined) => {
        if (!updated) return;
        const id = this.route.snapshot.paramMap.get('id');
        if (id) this.loadEnrollments(id);
      });
  }

  protected dismissNotice(): void {
    this.notice.set(null);
  }

  protected confirmConflictEnroll(): void {
    const prompt = this.conflictPrompt();
    if (!prompt) {
      return;
    }

    this.addToClass(prompt.cls, true);
  }

  protected cancelConflictPrompt(): void {
    this.enrollingClassId.set(null);
    this.conflictPrompt.set(null);
  }

  protected weekdayLabel(weekday: number): string {
    return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1] ?? `${weekday}`;
  }

  private addToClass(cls: Class, force = false): void {
    const s = this.student();
    if (!s) return;
    this.enrollingClassId.set(cls.id);
    this.enrollmentsService
      .create({ classId: cls.id, studentId: s.id, skipConflictCheck: force })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.enrollingClassId.set(null);
          this.conflictPrompt.set(null);
          // **這條入口不問計費**（班級頁那條會問）—— 所以「沒有計費設定」是它的
          // 常態結果，不是意外。用 `info` 不用 `warn`：**每次都出現的東西花不起
          // 警示色**，否則行政一週內就學會略過它。真正要人動手的訊號放在下面
          // 那一列的「未設定計費」標記上（那個只在真的缺模式時出現）。
          this.notice.set({
            severity: 'info',
            summary: '已加入班級',
            detail: `「${s.name}」已加入「${cls.name}」。這筆還沒有計費設定 —— 在下方該筆報名上點「設定計費」補上，否則不會產生帳單。`,
          });
          const id = this.route.snapshot.paramMap.get('id');
          if (id) this.loadEnrollments(id);
        },
        error: (err) => {
          this.enrollingClassId.set(null);
          const code = err?.error?.code;
          const warnings = err?.error?.warnings as ScheduleConflictWarning[] | undefined;

          if (code === 'SCHEDULE_CONFLICT' && warnings?.length) {
            this.conflictPrompt.set({ cls, warnings });
            this.notice.set(null);
            return;
          }

          this.conflictPrompt.set(null);

          if (code === 'OVER_QUOTA') {
            this.notice.set({
              severity: 'error',
              summary: '班級人數已達上限',
              detail: '無法將學生加入班級，請調整人數上限或改選其他班級',
            });
            return;
          }

          if (code === 'ALREADY_ENROLLED') {
            this.notice.set({
              severity: 'warning',
              summary: '已經在此班',
              detail: `「${s.name}」已經是「${cls.name}」的成員`,
            });
            return;
          }

          this.notice.set({
            severity: 'error',
            summary: '加入失敗',
            detail: '無法將學生加入班級，請稍後再試',
          });
        },
      });
  }

  private loadEnrollments(studentId: string): void {
    this.enrollmentsLoading.set(true);
    this.enrollmentsService
      .list({ studentId, pageSize: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.enrollments.set(
            res.data.filter((e) => ['active', 'pending_payment'].includes(e.status)),
          );
          this.enrollmentsLoading.set(false);
        },
        error: () => this.enrollmentsLoading.set(false),
      });
  }
  /**
   * 在籍 = 還在用；退班 / 失效 = 不在等任何事了；待付款 / 暫停 = 還在等某件事發生。
   *
   * **待付款沒有 overdue**：這一頁拿不到帳單的 `due_date`，而「逾期」的定義是
   * 過了 due_date 未繳清（billing-rules 規則 7）。沒有那個日期就沒有依據判逾期 ——
   * 金流頁才是講欠繳的地方。
   */
  protected enrollmentTone(status: EnrollmentStatus): StatusTone {
    if (status === 'active') return 'done';
    if (status === 'withdrawal' || status === 'void') return 'inactive';
    return 'pending';
  }
}
