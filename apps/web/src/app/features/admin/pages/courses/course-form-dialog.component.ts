import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MultiSelectModule } from 'primeng/multiselect';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig, DialogService } from 'primeng/dynamicdialog';
import { OverlayContainerService } from '@core/overlay-container.service';
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
import { DialogTitleDirective } from '@shared/directives/dialog-title.directive';
import { SelectFieldComponent } from '@shared/components/select-field/select-field.component';

@Component({
  selector: 'app-course-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    DialogTitleDirective,
    FormsModule,
    MultiSelectModule,
    SelectFieldComponent,
  ],
  templateUrl: './course-form-dialog.component.html',
})
export class CourseFormDialogComponent {
  private readonly coursesService = inject(CoursesService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected readonly loading = signal(false);
  protected readonly course = signal<Course | null>(this.config.data?.course ?? null);
  protected readonly campuses = signal<Campus[]>(this.config.data?.campuses ?? []);
  protected readonly subjects = signal<Subject[]>(this.config.data?.subjects ?? []);

  protected readonly formData = signal({
    campusId: this.course()?.campusId ?? this.campuses()[0]?.id ?? '',
    name: this.course()?.name ?? '',
    // A6：新增時科目先空著（「選擇科目」），不替使用者挑第一個
    subjectId: this.course()?.subjectId ?? '',
    description: this.course()?.description ?? '',
    isActive: this.course()?.isActive ?? true,
    gradeLevels: this.course()?.gradeLevels ?? [],
    deactivateMode: 'keep_sessions' as 'keep_sessions' | 'cancel_future_sessions',
  });

  protected readonly isEditing = computed(() => this.course() !== null);
  protected readonly shouldShowDeactivateMode = computed(
    () => this.isEditing() && !!this.course()?.isActive && !this.formData().isActive,
  );

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    // 稿：桌機聚焦第一個欄位（課程名稱）、手機不聚焦（不要一開就彈鍵盤）
    afterNextRender(() => {
      if (globalThis.matchMedia?.('(min-width: 861px)').matches)
        this.nameInput().nativeElement.focus();
    });
  }

  /** A6 `.fdlg__opt` radio（courses.html:305） */
  protected readonly statusOptions = [
    { label: '啟用', value: true },
    { label: '停用', value: false },
  ] as const;

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
  /** A6 `.fdlg__why`：「還沒填：科目、課程名稱」；都填了是 null */
  protected readonly missingHint = computed(() => {
    const form = this.formData();
    const missing = [
      !form.campusId && '分校',
      !form.subjectId && '科目',
      !form.name.trim() && '課程名稱',
      form.gradeLevels.length === 0 && '適合年級',
    ].filter(Boolean);
    return missing.length ? `還沒填：${missing.join('、')}` : null;
  });

  protected readonly campusName = computed(() => {
    const cid = this.formData().campusId;
    return this.campuses().find((c) => c.id === cid)?.name ?? '課程管理';
  });

  protected readonly gradeOptions = [
    { label: '小一', value: 'P1' },
    { label: '小二', value: 'P2' },
    { label: '小三', value: 'P3' },
    { label: '小四', value: 'P4' },
    { label: '小五', value: 'P5' },
    { label: '小六', value: 'P6' },
    { label: '國一', value: 'J1' },
    { label: '國二', value: 'J2' },
    { label: '國三', value: 'J3' },
    { label: '高一', value: 'S1' },
    { label: '高二', value: 'S2' },
    { label: '高三', value: 'S3' },
  ];

  protected save(): void {
    const form = this.formData();
    // A6 `.fdlg`：送出鈕不鎖死，沒填完就停在這裡，動作列左邊那行寫還差什麼
    if (this.missingHint()) return;

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
          const detail = this.buildUpdateSuccessDetail(
            form.name,
            form.isActive,
            form.deactivateMode,
            cancelledCount,
          );
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
        isActive: form.isActive,
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
      width: '400px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer ?? 'body',
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
