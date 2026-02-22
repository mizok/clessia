import { Component, inject, model, output, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { SubjectsService, Subject } from '@core/subjects.service';
import { signal } from '@angular/core';

@Component({
  selector: 'app-subject-manager',
  standalone: true,
  imports: [
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    ToastModule,
    SkeletonModule,
    TooltipModule,
  ],
  providers: [MessageService],
  templateUrl: './subject-manager.component.html',
  styleUrl: './subject-manager.component.scss',
})
export class SubjectManagerComponent {
  private readonly subjectsService = inject(SubjectsService);
  private readonly messageService = inject(MessageService);

  readonly visible = model(false);
  readonly changed = output<Subject[]>();

  protected readonly subjects = signal<Subject[]>([]);
  protected readonly loading = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editingName = signal('');
  protected readonly newSubjectName = signal('');
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      if (this.visible()) {
        this.loadSubjects();
      } else {
        this.editingId.set(null);
        this.editingName.set('');
        this.newSubjectName.set('');
      }
    });
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
        this.subjects.update((list) =>
          list.map((s) => (s.id === id ? res.data : s)),
        );
        this.editingId.set(null);
        this.editingName.set('');
        this.saving.set(false);
        this.changed.emit(this.subjects());
      },
      error: (err) => {
        this.messageService.add({
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
        this.messageService.add({
          severity: 'success',
          summary: '已刪除',
          detail: `「${subject.name}」已刪除`,
        });
        this.changed.emit(this.subjects());
      },
      error: (err) => {
        this.messageService.add({
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
        this.messageService.add({
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
}
