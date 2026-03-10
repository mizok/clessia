import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TextareaModule } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';
import {
  CoursesService,
  Course,
  CreateCourseInput,
  UpdateCourseInput,
  type UpdateCourseResult,
} from '@core/courses.service';
import { Campus } from '@core/campuses.service';
import { Subject } from '@core/subjects.service';

@Component({
  selector: 'app-course-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    ToggleSwitch,
    SelectModule,
    MultiSelectModule,
    TextareaModule,
  ],
  templateUrl: './course-form-dialog.component.html',
  styleUrl: './course-form-dialog.component.scss',
})
export class CourseFormDialogComponent {
  private readonly coursesService = inject(CoursesService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly course = signal<Course | null>(this.config.data?.course ?? null);
  protected readonly campuses = signal<Campus[]>(this.config.data?.campuses ?? []);
  protected readonly subjects = signal<Subject[]>(this.config.data?.subjects ?? []);

  protected readonly formData = signal({
    campusId: this.course()?.campusId ?? this.campuses()[0]?.id ?? '',
    name: this.course()?.name ?? '',
    subjectId: this.course()?.subjectId ?? this.subjects()[0]?.id ?? '',
    description: this.course()?.description ?? '',
    isActive: this.course()?.isActive ?? true,
    gradeLevels: this.course()?.gradeLevels ?? [],
    deactivateMode: 'keep_sessions' as 'keep_sessions' | 'cancel_future_sessions',
  });

  protected readonly isEditing = computed(() => this.course() !== null);
  protected readonly shouldShowDeactivateMode = computed(
    () => this.isEditing() && !!this.course()?.isActive && !this.formData().isActive,
  );

  protected readonly deactivateModeOptions = [
    { label: '停用課程（保留既有課堂）', value: 'keep_sessions' as const },
    { label: '停用並停課未來課堂', value: 'cancel_future_sessions' as const },
  ];

  protected readonly campusOptions = computed(() =>
    this.campuses()
      .filter((c) => c.isActive || c.id === this.formData().campusId)
      .map((c) => ({ label: c.name, value: c.id })),
  );

  protected readonly subjectOptions = computed(() =>
    this.subjects().map((s) => ({ label: s.name, value: s.id })),
  );
  protected readonly campusName = computed(() => {
    const cid = this.formData().campusId;
    return this.campuses().find((c) => c.id === cid)?.name ?? '課程管理';
  });

  protected readonly gradeOptions = [
    { label: '小一', value: '小一' },
    { label: '小二', value: '小二' },
    { label: '小三', value: '小三' },
    { label: '小四', value: '小四' },
    { label: '小五', value: '小五' },
    { label: '小六', value: '小六' },
    { label: '國一', value: '國一' },
    { label: '國二', value: '國二' },
    { label: '國三', value: '國三' },
    { label: '高一', value: '高一' },
    { label: '高二', value: '高二' },
    { label: '高三', value: '高三' },
  ];

  protected save(): void {
    const form = this.formData();
    if (!form.campusId) {
      this.messageService.add({ severity: 'warn', summary: '請選擇分校' });
      return;
    }
    if (!form.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: '請填寫課程名稱' });
      return;
    }
    if (!form.subjectId) {
      this.messageService.add({ severity: 'warn', summary: '請選擇科目' });
      return;
    }

    this.loading.set(true);

    if (this.isEditing()) {
      const input: UpdateCourseInput = {
        name: form.name.trim(),
        subjectId: form.subjectId,
        description: form.description.trim() || null,
        isActive: form.isActive,
        gradeLevels: form.gradeLevels,
        ...(this.shouldShowDeactivateMode() ? { deactivateMode: form.deactivateMode } : {}),
      };

      this.coursesService.update(this.course()!.id, input).subscribe({
        next: (res: UpdateCourseResult) => {
          const cancelledCount = res.cancelledFutureSessions ?? 0;
          const detail = this.buildUpdateSuccessDetail(form.name, form.isActive, form.deactivateMode, cancelledCount);
          this.messageService.add({
            severity: 'success',
            summary: '更新成功',
            detail,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '更新失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    } else {
      const input: CreateCourseInput = {
        campusId: form.campusId,
        name: form.name.trim(),
        subjectId: form.subjectId,
        description: form.description.trim() || null,
        gradeLevels: form.gradeLevels,
      };

      this.coursesService.create(input).subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '新增成功',
            detail: `「${form.name}」已建立`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '新增失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.loading.set(false);
        },
      });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected updateForm(field: keyof ReturnType<typeof this.formData>, value: any): void {
    this.formData.update((f) => ({ ...f, [field]: value }));
  }

  protected onStatusChange(isActive: boolean): void {
    this.formData.update((f) => ({
      ...f,
      isActive,
      deactivateMode: isActive ? 'keep_sessions' : f.deactivateMode,
    }));
  }

  protected openSubjectManager(): void {
    const dialogRef = this.dialogService.open(SubjectManagerComponent, {
      header: '管理科目',
      width: '400px',
      modal: true,
      showHeader: false,
    });

    if (dialogRef) {
      dialogRef.onClose.subscribe((updatedSubjects: Subject[]) => {
        if (updatedSubjects) {
          this.subjects.set(updatedSubjects);
        }
      });
    }
  }

  private buildUpdateSuccessDetail(
    courseName: string,
    isActive: boolean,
    deactivateMode: 'keep_sessions' | 'cancel_future_sessions',
    cancelledCount: number,
  ): string {
    if (!isActive && deactivateMode === 'cancel_future_sessions') {
      if (cancelledCount > 0) {
        return `「${courseName}」已停用，已取消 ${cancelledCount} 堂未來課堂`;
      }
      return `「${courseName}」已停用，沒有可取消的未來課堂`;
    }

    return `「${courseName}」已更新`;
  }
}
