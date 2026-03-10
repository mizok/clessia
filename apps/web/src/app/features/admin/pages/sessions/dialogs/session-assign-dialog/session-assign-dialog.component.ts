import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { SessionsService, type Session } from '@core/sessions.service';
import { StaffService, type Staff } from '@core/staff.service';
import { CoursesService } from '@core/courses.service';
import { forkJoin } from 'rxjs';

interface SessionAssignDialogData {
  readonly session?: Session;
  readonly teachers?: readonly Staff[];
}

@Component({
  selector: 'app-session-assign-dialog',
  imports: [ReactiveFormsModule, ButtonModule, SelectModule],
  templateUrl: './session-assign-dialog.component.html',
  styleUrl: './session-assign-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionAssignDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly sessionsService = inject(SessionsService);
  private readonly staffService = inject(StaffService);
  private readonly coursesService = inject(CoursesService);
  private readonly messageService = inject(MessageService);
  private readonly fb = inject(FormBuilder);

  readonly session = signal<Session | null>(null);
  readonly teachers = signal<Staff[]>([]);
  readonly loadingTeachers = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly form = this.fb.group({
    teacherId: ['', Validators.required],
  });

  ngOnInit(): void {
    const data = this.config.data as SessionAssignDialogData | undefined;
    if (!data?.session) {
      this.submitError.set('缺少課堂資料，無法指派老師');
      return;
    }

    this.session.set(data.session);
    const providedTeachers = [...(data.teachers ?? [])];
    if (providedTeachers.length > 0) {
      this.teachers.set(providedTeachers);
      return;
    }

    this.loadTeachers();
  }

  protected closeDialog(): void {
    this.ref.close();
  }

  protected submit(): void {
    this.submitError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const currentSession = this.session();
    const teacherId = this.form.value.teacherId;
    if (!currentSession || !teacherId) {
      return;
    }

    this.isSubmitting.set(true);
    this.sessionsService
      .batchAssignTeacher({
        sessionIds: [currentSession.id],
        teacherId,
      })
      .subscribe({
        next: (result) => {
          if (result.updated > 0) {
            this.messageService.add({
              severity: 'success',
              summary: '成功',
              detail: '已完成老師指派',
            });
            this.ref.close('refresh');
            return;
          }

          const conflictMessage =
            result.skippedNotEligible > 0
              ? '該老師未具備此課程科目或分校資格'
              : result.conflicts.length > 0
                ? '該老師於此時段已有其他課堂，請改選其他老師'
                : '沒有可更新的課堂';
          this.submitError.set(conflictMessage);
          this.isSubmitting.set(false);
        },
        error: (err: { error?: { error?: string; message?: string } }) => {
          this.submitError.set(err.error?.error ?? err.error?.message ?? '指派失敗，請稍後再試');
          this.isSubmitting.set(false);
        },
      });
  }

  private loadTeachers(): void {
    const currentSession = this.session();
    if (!currentSession) {
      this.teachers.set([]);
      return;
    }

    this.loadingTeachers.set(true);
    forkJoin({
      teachersRes: this.staffService.list({ role: 'teacher', campusId: currentSession.campusId }),
      courseRes: this.coursesService.get(currentSession.courseId),
    }).subscribe({
      next: ({ teachersRes, courseRes }) => {
        const subjectId = courseRes.data.subjectId;
        const eligibleTeachers = teachersRes.data.filter(
          (teacher) =>
            teacher.campusIds.includes(currentSession.campusId) &&
            teacher.subjectIds.includes(subjectId),
        );
        this.teachers.set(eligibleTeachers);
        this.loadingTeachers.set(false);
      },
      error: () => {
        this.submitError.set('無法載入老師清單，請稍後再試');
        this.loadingTeachers.set(false);
      },
    });
  }
}
