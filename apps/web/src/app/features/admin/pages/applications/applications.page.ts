import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogService } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';

import {
  PublicApplicationsService,
  type PublicApplication,
  type PublicApplicationStatus,
} from '@core/public-applications.service';
import { GRADE_LEVEL_LABELS } from '@core/students.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ParentFormDialogComponent } from '@shared/components/parent-form-dialog/parent-form-dialog.component';

const STATUS_OPTIONS: Array<{ label: string; value: PublicApplicationStatus }> = [
  { label: '新申請', value: 'new' },
  { label: '已聯絡', value: 'contacted' },
  { label: '已轉入', value: 'converted' },
  { label: '不受理', value: 'rejected' },
  { label: '垃圾送件', value: 'spam' },
];

/** 篩選：「待處理」是 new＋contacted 兩個狀態，其餘一對一 */
const FILTERS: Array<{ label: string; statuses: PublicApplicationStatus[] }> = [
  { label: '待處理', statuses: ['new', 'contacted'] },
  { label: '已轉入', statuses: ['converted'] },
  { label: '不受理', statuses: ['rejected'] },
  { label: '垃圾送件', statuses: ['spam'] },
];

const RELATION_LABELS = { father: '父親', mother: '母親', other: '其他' } as const;

/**
 * 公開申請（#1245）：公開報名／試聽表單（#1123、#1124）送進來的、還沒建檔的人。
 *
 * 狀態是聯絡流程，任意切換。「建立家長」開既有的新增家長表單並預填 ——
 * **不自動改狀態、不自動建學生或報名**：rules/enrollment-rules.md 1.4 是首次收款才建主資料，
 * 學生建檔、報名、開帳本來就有各自的流程與檢查（計畫席裁：自動轉檔上線用過再說）。
 *
 * 卡片清單而不是表格：行政多半在手機上處理（page-actions 的 80% 裁定），一筆申請的欄位又多。
 */
@Component({
  selector: 'app-applications',
  imports: [DatePipe, FormsModule, ButtonModule, SelectModule, TextareaModule, PageOpenComponent],
  providers: [DialogService],
  templateUrl: './applications.page.html',
})
export class ApplicationsPage {
  private readonly service = inject(PublicApplicationsService);
  private readonly messages = inject(MessageService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly filters = FILTERS;
  protected readonly kindOptions = [
    { label: '全部', value: null },
    { label: '報名', value: 'enrollment' as const },
    { label: '試聽', value: 'trial' as const },
  ];
  protected readonly gradeLabels = GRADE_LEVEL_LABELS;
  protected readonly relationLabels = RELATION_LABELS;

  protected readonly filter = signal(FILTERS[0]!);
  protected readonly kind = signal<'enrollment' | 'trial' | null>(null);
  protected readonly applications = signal<PublicApplication[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.service
      .list({ statuses: this.filter().statuses, kind: this.kind() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.applications.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  protected setFilter(filter: (typeof FILTERS)[number]): void {
    this.filter.set(filter);
    this.load();
  }

  protected setKind(kind: 'enrollment' | 'trial' | null): void {
    this.kind.set(kind);
    this.load();
  }

  protected setStatus(app: PublicApplication, status: PublicApplicationStatus): void {
    if (status === app.status) return;
    this.patch(app, { status });
  }

  /** 失焦存；沒改不送 */
  protected saveNote(app: PublicApplication, value: string): void {
    const note = value.trim() || null;
    if (note === (app.staffNote ?? null)) return;
    this.patch(app, { staffNote: note });
  }

  protected createParent(app: PublicApplication): void {
    this.dialog.open(ParentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        parent: null,
        prefill: { name: app.parent.name, email: app.parent.email, phone: app.parent.phone },
      },
    });
  }

  private patch(
    app: PublicApplication,
    patch: { status?: PublicApplicationStatus; staffNote?: string | null },
  ): void {
    this.service.update(app.id, patch).subscribe({
      next: (res) =>
        this.applications.update((list) => list.map((a) => (a.id === app.id ? res.data : a))),
      error: () =>
        this.messages.add({ severity: 'error', summary: '儲存失敗', detail: '請稍後再試' }),
    });
  }
}
