import { Component, inject, output, signal, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SubjectsService } from '@core/subjects.service';
import type { Subject } from '@core/subjects.service';
import { ReferenceDataService } from '@core/reference-data.service';
import {
  InlineNoticeComponent,
  type InlineNoticeSeverity,
} from '@shared/components/inline-notice/inline-notice.component';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '@shared/components/confirm-dialog/confirm-dialog.component';

interface SubjectManagerNotice {
  readonly severity: InlineNoticeSeverity;
  readonly summary: string;
  readonly detail: string;
}

@Component({
  selector: 'app-subject-manager',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    SkeletonModule,
    TooltipModule,
    InlineNoticeComponent,
  ],
  providers: [DialogService],
  templateUrl: './subject-manager.component.html',
  styleUrl: './subject-manager.component.scss',
})
export class SubjectManagerComponent implements OnInit, OnDestroy {
  private readonly subjectsService = inject(SubjectsService);
  private readonly dialogService = inject(DialogService);
  private readonly ref = inject(DynamicDialogRef, { optional: true });
  private readonly refData = inject(ReferenceDataService);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly changed = output<Subject[]>();

  protected readonly subjects = signal<Subject[]>([]);
  protected readonly loading = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editingName = signal('');
  protected readonly newSubjectName = signal('');
  protected readonly saving = signal(false);
  protected readonly notice = signal<SubjectManagerNotice | null>(null);
  protected readonly isDialog = signal(!!this.ref);

  ngOnInit(): void {
    this.loadSubjects();
  }

  ngOnDestroy(): void {
    this.clearNoticeTimer();
  }

  protected cancel(): void {
    this.ref?.close();
  }

  protected dismissNotice(): void {
    this.clearNotice();
  }

  protected loadSubjects(): void {
    this.loading.set(true);
    this.subjectsService.list().subscribe({
      next: (res) => {
        this.subjects.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  protected startEdit(subject: Subject): void {
    this.editingId.set(subject.id);
    this.editingName.set(subject.name);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editingName.set('');
  }

  protected confirmRename(): void {
    const id = this.editingId();
    const name = this.editingName().trim();
    if (!id || !name) return;

    this.saving.set(true);
    this.subjectsService.update(id, name).subscribe({
      next: (res) => {
        this.subjects.update((list) => list.map((s) => (s.id === id ? res.data : s)));
        this.editingId.set(null);
        this.editingName.set('');
        this.saving.set(false);
        this.refData.invalidate('subjects');
        this.changed.emit(this.subjects());
      },
      error: (err) => {
        this.showNotice({
          severity: 'error',
          summary: '更新失敗',
          detail: err.error?.error || '科目名稱更新失敗',
        });
        this.saving.set(false);
      },
    });
  }

  /**
   * `courseCount`/`academyExamCount`（PR #392）到位後，用量在事先就查得到，
   * 不用再等 409 才知道——跟 `Student.hasEnrollments` 同一個範本。這裡只算
   * 文字，實際擋點擊的 `[disabled]` 在 template。
   */
  protected deleteBlockReason(subject: Subject): string | null {
    const parts: string[] = [];
    if (subject.courseCount > 0) parts.push(`${subject.courseCount} 個課程`);
    if (subject.academyExamCount > 0) parts.push(`${subject.academyExamCount} 場校內考`);
    if (parts.length === 0) return null;
    return `已被${parts.join('、')}使用中，無法刪除`;
  }

  protected confirmDelete(subject: Subject): void {
    const dialogRef = this.dialogService.open(ConfirmDialogComponent, {
      header: '確認刪除科目',
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: 'body',
      data: {
        message: `確定要刪除「${subject.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      } satisfies ConfirmDialogData,
    });

    if (!dialogRef) return;
    dialogRef.onClose.subscribe((confirmed) => {
      if (!confirmed) return;
      this.subjectsService.delete(subject.id).subscribe({
        next: () => {
          this.subjects.update((list) => list.filter((s) => s.id !== subject.id));
          this.showNotice({
            severity: 'success',
            summary: '已刪除',
            detail: `「${subject.name}」已刪除`,
          });
          this.refData.invalidate('subjects');
          this.changed.emit(this.subjects());
        },
        error: (err) => {
          this.showNotice({
            severity: 'error',
            summary: '無法刪除',
            detail: err.error?.error || '刪除失敗',
          });
        },
      });
    });
  }

  protected addSubject(): void {
    const name = this.newSubjectName().trim();
    if (!name) {
      this.showNotice({
        severity: 'warning',
        summary: '尚未輸入科目名稱',
        detail: '請先輸入名稱再新增',
      });
      return;
    }

    this.saving.set(true);
    this.subjectsService.create(name).subscribe({
      next: (res) => {
        this.subjects.update((list) => [...list, res.data]);
        this.newSubjectName.set('');
        this.saving.set(false);
        this.showNotice({
          severity: 'success',
          summary: '已新增',
          detail: `「${res.data.name}」已新增`,
        });
        this.refData.invalidate('subjects');
        this.changed.emit(this.subjects());
      },
      error: (err) => {
        this.showNotice({
          severity: 'error',
          summary: '新增失敗',
          detail: err.error?.error || '科目新增失敗',
        });
        this.saving.set(false);
      },
    });
  }

  protected onNewNameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.addSubject();
    if (event.key === 'Escape') this.newSubjectName.set('');
  }

  protected onEditNameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.confirmRename();
    if (event.key === 'Escape') this.cancelEdit();
  }

  private showNotice(notice: SubjectManagerNotice): void {
    this.notice.set(notice);
    this.clearNoticeTimer();
    this.noticeTimer = globalThis.setTimeout(() => this.notice.set(null), 5000);
  }

  private clearNotice(): void {
    this.notice.set(null);
    this.clearNoticeTimer();
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer === null) {
      return;
    }

    globalThis.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }
}
