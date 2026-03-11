import { Component, inject, output, signal, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { SubjectsService } from '@core/subjects.service';
import type { Subject } from '@core/subjects.service';

interface SubjectManagerNotice {
  readonly severity: 'success' | 'error';
  readonly summary: string;
  readonly detail: string;
}

@Component({
  selector: 'app-subject-manager',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, SkeletonModule, TooltipModule],
  templateUrl: './subject-manager.component.html',
  styleUrl: './subject-manager.component.scss',
})
export class SubjectManagerComponent implements OnInit, OnDestroy {
  private readonly subjectsService = inject(SubjectsService);
  private readonly ref = inject(DynamicDialogRef);
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly changed = output<Subject[]>();

  protected readonly subjects = signal<Subject[]>([]);
  protected readonly loading = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editingName = signal('');
  protected readonly newSubjectName = signal('');
  protected readonly saving = signal(false);
  protected readonly notice = signal<SubjectManagerNotice | null>(null);

  ngOnInit(): void {
    this.loadSubjects();
  }

  ngOnDestroy(): void {
    this.clearNoticeTimer();
  }

  protected cancel(): void {
    this.ref.close();
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

  protected confirmDelete(subject: Subject): void {
    this.subjectsService.delete(subject.id).subscribe({
      next: () => {
        this.subjects.update((list) => list.filter((s) => s.id !== subject.id));
        this.showNotice({
          severity: 'success',
          summary: '已刪除',
          detail: `「${subject.name}」已刪除`,
        });
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
  }

  protected addSubject(): void {
    const name = this.newSubjectName().trim();
    if (!name) return;

    this.saving.set(true);
    this.subjectsService.create(name).subscribe({
      next: (res) => {
        this.subjects.update((list) => [...list, res.data]);
        this.newSubjectName.set('');
        this.saving.set(false);
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
