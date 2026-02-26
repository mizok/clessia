import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { ClassesService, Class, SessionPreview } from '@core/classes.service';
import { format } from 'date-fns';

@Component({
  selector: 'app-generate-sessions-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DatePickerModule],
  templateUrl: './generate-sessions-dialog.component.html',
  styleUrl: './generate-sessions-dialog.component.scss',
})
export class GenerateSessionsDialogComponent {
  private readonly classesService = inject(ClassesService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly step = signal<'input' | 'preview'>('input');

  protected readonly generateFrom = signal<Date | null>(null);
  protected readonly generateTo = signal<Date | null>(null);
  protected readonly excludeDates = signal<Date[]>([]);
  protected readonly previewSessions = signal<SessionPreview[]>([]);

  protected readonly newCount = computed(
    () => this.previewSessions().filter((s) => !s.exists).length,
  );
  protected readonly skippedCount = computed(
    () => this.previewSessions().filter((s) => s.exists).length,
  );

  protected readonly breadcrumb = computed(() => {
    const c = this.cls();
    if (!c) return '';
    return `${c.campusName ?? ''} › ${c.courseName ?? ''} › ${c.name}`;
  });

  protected preview(): void {
    const c = this.cls();
    const from = this.generateFrom();
    const to = this.generateTo();
    if (!c || !from || !to) {
      this.messageService.add({ severity: 'warn', summary: '請選擇完整日期範圍' });
      return;
    }

    this.loading.set(true);
    const fromStr = format(from, 'yyyy-MM-dd');
    const toStr = format(to, 'yyyy-MM-dd');
    const exclude = this.excludeDates().map((d) => format(d, 'yyyy-MM-dd'));

    this.classesService.previewSessions(c.id, fromStr, toStr, exclude).subscribe({
      next: (res) => {
        this.previewSessions.set(res.data);
        this.loading.set(false);
        this.step.set('preview');
      },
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '預覽失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected confirm(): void {
    const c = this.cls();
    const from = this.generateFrom();
    const to = this.generateTo();
    if (!c || !from || !to) return;

    this.loading.set(true);
    const fromStr = format(from, 'yyyy-MM-dd');
    const toStr = format(to, 'yyyy-MM-dd');
    const exclude = this.excludeDates().map((d) => format(d, 'yyyy-MM-dd'));

    this.classesService.generateSessions(c.id, fromStr, toStr, exclude).subscribe({
      next: (res) => {
        this.loading.set(false);
        const created = res.createdAssigned + res.createdUnassigned;
        const skipped = res.skippedExisting + res.skippedNoTeacher;
        this.messageService.add({
          severity: 'success',
          summary: '課堂產生完成',
          detail: `已建立 ${created} 筆，略過 ${skipped} 筆`,
        });
        this.ref.close(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: '產生失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }
}
