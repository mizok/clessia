import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ParentsService, type ParentDetail, type ParentDetailStudent } from '@core/parents.service';
import {
  EnrollmentsService,
  type ScheduleConflictWarning,
} from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import type { Class } from '@core/classes.service';
import { ClassPickerDialogComponent } from '@shared/components/class-picker-dialog/class-picker-dialog.component';
import {
  InlineNoticeComponent,
  type InlineNoticeSeverity,
} from '@shared/components/inline-notice/inline-notice.component';

interface InlineNoticeState {
  readonly severity: InlineNoticeSeverity;
  readonly summary: string;
  readonly detail: string;
}

interface ConflictPrompt {
  readonly student: ParentDetailStudent;
  readonly cls: Class;
  readonly warnings: readonly ScheduleConflictWarning[];
}

@Component({
  selector: 'app-parent-detail-dialog',
  standalone: true,
  imports: [ButtonModule, SkeletonModule, InlineNoticeComponent],
  providers: [DialogService],
  templateUrl: './parent-detail-dialog.component.html',
  styleUrl: './parent-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParentDetailDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly parentsService = inject(ParentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly parent = signal<ParentDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly enrollingStudentId = signal<string | null>(null);
  protected readonly notice = signal<InlineNoticeState | null>(null);
  protected readonly conflictPrompt = signal<ConflictPrompt | null>(null);
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    const parentId = this.config.data?.parentId as string | undefined;
    if (!parentId) {
      this.loading.set(false);
      return;
    }

    this.parentsService
      .get(parentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.parent.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  protected getGradeLabel(grade: string): string {
    return this.gradeLevelLabels[grade as GradeLevel] ?? grade;
  }

  protected openClassPicker(student: ParentDetailStudent): void {
    this.enrollingStudentId.set(student.id);

    const ref = this.dialogService.open(ClassPickerDialogComponent, {
      header: `${student.name} — 選擇班級`,
      width: '520px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data: {
        existingClassIds: [],
        studentGrade: student.grade as GradeLevel,
      },
    });

    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cls: Class | undefined) => {
        if (cls) {
          this.enroll(student, cls);
        } else {
          this.enrollingStudentId.set(null);
        }
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

    this.enroll(prompt.student, prompt.cls, true);
  }

  protected cancelConflictPrompt(): void {
    this.enrollingStudentId.set(null);
    this.conflictPrompt.set(null);
  }

  protected weekdayLabel(weekday: number): string {
    return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1] ?? `${weekday}`;
  }

  private enroll(student: ParentDetailStudent, cls: Class, force = false): void {
    this.enrollingStudentId.set(student.id);
    this.enrollmentsService
      .create({ classId: cls.id, studentId: student.id, skipConflictCheck: force })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.enrollingStudentId.set(null);
          this.conflictPrompt.set(null);
          this.notice.set({
            severity: 'success',
            summary: '報名成功',
            detail: `「${student.name}」已加入「${cls.name}」`,
          });
        },
        error: (err) => {
          this.enrollingStudentId.set(null);
          const code = err?.error?.code;
          const warnings = err?.error?.warnings as ScheduleConflictWarning[] | undefined;

          if (code === 'SCHEDULE_CONFLICT' && warnings?.length) {
            this.conflictPrompt.set({ student, cls, warnings });
            this.notice.set(null);
            return;
          }

          this.conflictPrompt.set(null);

          if (code === 'OVER_QUOTA') {
            this.notice.set({
              severity: 'error',
              summary: '班級人數已達上限',
              detail: '無法加入，請聯絡管理員調整上限或改選其他班級',
            });
            return;
          }

          if (code === 'ALREADY_ENROLLED') {
            this.notice.set({
              severity: 'warning',
              summary: '已經在此班',
              detail: `「${student.name}」已經是「${cls.name}」的成員`,
            });
            return;
          }

          this.notice.set({
            severity: 'error',
            summary: '報名失敗',
            detail: '無法完成報名，請稍後再試',
          });
        },
      });
  }
}
