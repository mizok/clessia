import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AutoCompleteModule, type AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ParentsService, type ParentDetail, type ParentDetailStudent } from '@core/parents.service';
import { EnrollmentsService, type ScheduleConflictWarning } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  GRADE_LEVEL_LABELS,
  StudentsService,
  type GradeLevel,
  type Student,
} from '@core/students.service';
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
  imports: [AutoCompleteModule, FormsModule, ButtonModule, SkeletonModule, InlineNoticeComponent],
  providers: [DialogService],
  templateUrl: './parent-detail-dialog.component.html',
  styleUrl: './parent-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParentDetailDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly parentsService = inject(ParentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly studentsService = inject(StudentsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly parent = signal<ParentDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly enrollingStudentId = signal<string | null>(null);
  protected readonly notice = signal<InlineNoticeState | null>(null);
  protected readonly conflictPrompt = signal<ConflictPrompt | null>(null);
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly binding = signal(false);

  /** 搜尋既有學生 —— 已經綁在這個家長底下的不再列出來 */
  protected searchStudents(event: AutoCompleteCompleteEvent): void {
    const alreadyBound = new Set(this.parent()?.students.map((s) => s.id) ?? []);
    this.studentsService
      .list({ search: event.query, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data.filter((s) => !alreadyBound.has(s.id))),
        error: () => this.studentSuggestions.set([]),
      });
  }

  /**
   * 綁定一個**既有**的學生。
   *
   * ⚠️ **`studentIds` 是全量替換**（後端 `parents.ts:632` 先 delete 再 insert），
   * 所以這裡送的是「現有的全部 ＋ 新的那一個」，**不是只送新的那一個**。
   *
   * **這個操作放在這個對話框、而不是學生頁，正是因為這裡手上就有完整清單**
   * （`parentDetail.students`）。學生頁要先 GET 再 PUT，而
   * 「GET 失敗或回空」跟「這個家長本來就只有一個小孩」在程式裡長得一樣 ——
   * **能繞開那一步比能做那一步有價值**（#641 裁定的依據）。
   *
   * 防呆：`current` 取不到就直接不送。**寧可不做，也不要送一份可能不完整的清單。**
   */
  protected bindExistingStudent(picked: Student | string | null): void {
    const detail = this.parent();
    if (!detail || !picked || typeof picked === 'string') return;

    const current = detail.students.map((s) => s.id);
    if (current.includes(picked.id)) return;

    this.binding.set(true);
    this.parentsService
      .update(detail.id, { studentIds: [...current, picked.id] })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.binding.set(false);
          this.notice.set({
            severity: 'success',
            summary: '已綁定',
            detail: `「${picked.name}」已關聯至「${detail.name}」`,
          });
          this.loadParent();
        },
        error: () => {
          this.binding.set(false);
          this.notice.set({
            severity: 'error',
            summary: '綁定失敗',
            detail: '請稍後再試。既有的關聯沒有變動。',
          });
        },
      });
  }

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    this.loadParent();
  }

  private loadParent(): void {
    const parentId = (this.config.data?.parentId as string | undefined) ?? this.parent()?.id;
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
  /**
   * **這支對話框原本沒有任何關閉入口**（#714）。
   *
   * 開啟設定沒帶 `closable`，而 `DynamicDialogComponent` 一律把
   * `[closable]="ddconfig.closable"` 綁給內層 `p-dialog` —— **沒帶就是 `undefined`，
   * 把 `p-dialog` 自己的預設 `true` 蓋掉**，於是 header 的 × 不渲染。
   * Escape 與點遮罩也都沒開。使用者只能重新整理整頁。
   *
   * 補在內容區而不是去開 `closable` —— 這個 app 其餘的對話框都是這個形狀
   * （`invoice-detail`、`uninvoiced`、`session-leave-roster` …），
   * **一致性比少打一行重要**；而改 `closable` 的預設會動到全部 12 個開啟點。
   */
  protected close(): void {
    this.ref.close();
  }
}
