import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  ClassesService,
  Class,
  SessionPreview,
  type GenerateSessionsResult,
} from '@core/classes.service';
import { BrowserStateService } from '@core/browser-state.service';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import { format } from 'date-fns';

@Component({
  selector: 'app-generate-sessions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    ResponsiveTableComponent,
    RtColCellDirective,
    RtColDefDirective,
    RtRowDirective,
  ],
  templateUrl: './generate-sessions-dialog.component.html',
  styleUrl: './generate-sessions-dialog.component.scss',
})
export class GenerateSessionsDialogComponent {
  private readonly classesService = inject(ClassesService);
  private readonly browserStateService = inject(BrowserStateService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly loading = signal(false);
  protected readonly cls = signal<Class | null>(this.config.data?.cls ?? null);
  protected readonly step = signal<'input' | 'preview' | 'result'>('input');
  protected readonly generationResult = signal<GenerateSessionsResult | null>(null);

  protected readonly generateFrom = signal<Date | null>(null);
  protected readonly generateTo = signal<Date | null>(null);
  protected readonly excludeDates = signal<Date[]>([]);
  protected readonly previewSessions = signal<SessionPreview[]>([]);
  protected readonly previewPaginationFirst = signal(0);
  protected readonly previewPaginationRows = signal(10);
  protected readonly previewPaginationRowsPerPageOptions = [10, 20, 50];
  protected readonly isMobile = this.browserStateService.isMobile;

  protected readonly newCount = computed(
    () => this.previewSessions().filter((s) => !s.exists).length,
  );
  protected readonly skippedCount = computed(
    () => this.previewSessions().filter((s) => s.exists).length,
  );
  protected readonly paginatedPreviewSessions = computed(() => {
    const first = this.previewPaginationFirst();
    const rows = this.previewPaginationRows();
    return this.previewSessions().slice(first, first + rows);
  });
  protected readonly previewPagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: this.previewPaginationFirst(),
    rows: this.previewPaginationRows(),
    totalRecords: this.previewSessions().length,
    rowsPerPageOptions: this.isMobile() ? undefined : this.previewPaginationRowsPerPageOptions,
    showCurrentPageReport: true,
    currentPageReportTemplate: this.isMobile()
      ? '第 {currentPage} / {totalPages} 頁'
      : '顯示 {first} - {last}，共 {totalRecords} 筆',
  }));

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
        this.previewPaginationFirst.set(0);
        this.loading.set(false);
        this.step.set('preview');
        if (res.data.length > 200) {
          this.messageService.add({
            severity: 'warn',
            summary: '數量較多',
            detail: `即將建立 ${res.data.filter((s) => !s.exists).length} 堂課，請確認日期範圍是否正確`,
          });
        }
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
        this.generationResult.set(res);
        this.step.set('result');
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

  protected closeDone(): void {
    this.ref.close('refresh');
  }

  protected goToSessionsList(): void {
    const c = this.cls();
    const from = this.generateFrom();
    const to = this.generateTo();
    this.ref.close({
      action: 'navigate-sessions',
      classId: c?.id,
      campusId: c?.campusId,
      courseId: c?.courseId,
      from: from ? format(from, 'yyyy-MM-dd') : undefined,
      to: to ? format(to, 'yyyy-MM-dd') : undefined,
    });
  }

  protected cancel(): void {
    this.ref.close(this.generationResult() ? 'refresh' : undefined);
  }

  protected onPreviewPaginationChange(event: ResponsiveTablePageEvent): void {
    this.previewPaginationFirst.set(event.first);
    this.previewPaginationRows.set(event.rows);
  }

  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }
}
