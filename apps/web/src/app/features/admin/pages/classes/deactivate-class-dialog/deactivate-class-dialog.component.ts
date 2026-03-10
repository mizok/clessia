import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';

@Component({
  selector: 'app-deactivate-class-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './deactivate-class-dialog.component.html',
  styleUrl: './deactivate-class-dialog.component.scss',
})
export class DeactivateClassDialogComponent {
  private readonly classesService = inject(ClassesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);

  protected readonly breadcrumb = computed(() => {
    const c = this.cls();
    if (!c) return '';
    return `${c.campusName ?? ''} › ${c.courseName ?? ''} › ${c.name}`;
  });

  protected deactivateOnly(): void {
    const c = this.cls();
    if (!c) return;
    this.loading.set(true);
    this.classesService.toggleActive(c.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '停用成功',
          detail: `「${c.name}」已停用`,
        });
        this.ref.close(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected deactivateAndCancel(): void {
    const c = this.cls();
    if (!c) return;
    this.loading.set(true);
    this.classesService.toggleActive(c.id).subscribe({
      next: () => {
        this.classesService.cancelFutureSessions(c.id).subscribe({
          next: (res) => {
            this.messageService.add({
              severity: 'success',
              summary: '停用成功',
              detail: `「${c.name}」已停用，已停課 ${res.cancelled} 筆未來課堂`,
            });
            this.ref.close(true);
          },
          error: () => {
            this.messageService.add({
              severity: 'warn',
              summary: '班級已停用',
              detail: '停課未來課堂時發生錯誤，請手動確認',
            });
            this.ref.close(true);
          },
        });
      },
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected cancel(): void {
    this.ref.close();
  }
}
