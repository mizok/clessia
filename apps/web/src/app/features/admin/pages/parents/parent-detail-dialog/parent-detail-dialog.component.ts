import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ParentsService, type ParentDetail, type ParentDetailStudent } from '@core/parents.service';
import { EnrollmentsService } from '@core/enrollments.service';
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
      this.enrollingStudentId.set(null);
      if (cls) {
        this.enroll(student, cls);
      }
    });
  }

  protected dismissNotice(): void {
    this.notice.set(null);
  }

  private enroll(student: ParentDetailStudent, cls: Class): void {
    this.enrollmentsService
      .create({ classId: cls.id, studentId: student.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.notice.set({
            severity: 'success',
            summary: '報名成功',
            detail: `「${student.name}」已加入「${cls.name}」`,
          });
        },
        error: () => {
          this.notice.set({
            severity: 'error',
            summary: '報名失敗',
            detail: '無法完成報名，請稍後再試',
          });
        },
      });
  }
}
