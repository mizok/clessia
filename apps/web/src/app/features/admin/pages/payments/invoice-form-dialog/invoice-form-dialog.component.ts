import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  INVOICE_ITEM_TYPE_LABELS,
  InvoicesService,
  type CreateInvoiceItemInput,
  type InvoiceItemType,
} from '@core/invoices.service';
import { StudentsService, type Student } from '@core/students.service';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

interface DraftItem {
  type: InvoiceItemType;
  amount: number;
  note: string;
}

/**
 * 手動開帳。
 *
 * **這是行政的例外路徑**，不是主要路徑 —— 月繳/期繳的批次開帳走 run（A3）。
 * 手動開帳處理的是 run 涵蓋不到的個案：補開、雜費、人工調整。
 *
 * `dueDate` 不填就由後端用 org 的 `invoice_due_days` 算（預設 14 天，對齊
 * 「發袋後兩三週沒回音才催」的節奏）。這裡刻意不預先算好顯示 ——
 * 前端算一次、後端算一次，兩邊的預設值遲早會不一樣。
 */
@Component({
  selector: 'app-invoice-form-dialog',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    StudentAutocompleteComponent,
  ],
  templateUrl: './invoice-form-dialog.component.html',
  styleUrl: './invoice-form-dialog.component.scss',
})
export class InvoiceFormDialogComponent {
  private readonly service = inject(InvoicesService);
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);

  protected readonly saving = signal(false);

  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);

  protected readonly issuedAt = signal(new Date());
  /** null = 交給後端用 org 設定算 */
  protected readonly dueDate = signal<Date | null>(null);
  protected readonly note = signal('');

  protected readonly items = signal<DraftItem[]>([{ type: 'tuition', amount: 0, note: '' }]);

  protected readonly itemTypeOptions = (
    Object.keys(INVOICE_ITEM_TYPE_LABELS) as InvoiceItemType[]
  ).map((value) => ({ value, label: INVOICE_ITEM_TYPE_LABELS[value] }));

  /** 調整列可以是負數，所以總額用加的不用絕對值 */
  protected readonly total = computed(() =>
    this.items().reduce((sum, item) => sum + Math.round(item.amount || 0), 0),
  );

  protected readonly selectedStudent = computed(() => {
    const value = this.student();
    return typeof value === 'string' || value === null ? null : value;
  });

  protected onStudentQuery(query: string): void {
    if (!query.trim()) {
      this.studentSuggestions.set([]);
      return;
    }

    this.studentsService
      .list({ search: query, searchScope: 'student_name', pageSize: 20 })
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data),
        error: () => this.studentSuggestions.set([]),
      });
  }

  protected addItem(): void {
    this.items.update((list) => [...list, { type: 'tuition', amount: 0, note: '' }]);
  }

  protected removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  protected updateItem<K extends keyof DraftItem>(
    index: number,
    field: K,
    value: DraftItem[K],
  ): void {
    this.items.update((list) =>
      list.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  protected save(): void {
    const student = this.selectedStudent();
    if (!student) {
      this.messageService.add({
        severity: 'warn',
        summary: '請選擇學生',
        detail: '輸入姓名後從清單挑一位 —— 帳單一定屬於某個學生',
      });
      return;
    }

    // 金額 0 的列是使用者按了「新增明細」卻沒填 —— 丟掉比開出一張含 0 元列的帳單好
    const items: CreateInvoiceItemInput[] = this.items()
      .filter((item) => Math.round(item.amount || 0) !== 0)
      .map((item) => ({
        type: item.type,
        amount: Math.round(item.amount),
        note: item.note.trim() || undefined,
      }));

    if (items.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '請至少填一筆明細',
        detail: '沒有明細的帳單金額是 0，收不到錢也印不出收費袋',
      });
      return;
    }

    this.saving.set(true);
    const dueDate = this.dueDate();
    this.service
      .create({
        studentId: student.id,
        issuedAt: format(this.issuedAt(), 'yyyy-MM-dd'),
        // 不給 dueDate 後端才會套 org 設定；給 null 是「這張沒有到期日」
        ...(dueDate ? { dueDate: format(dueDate, 'yyyy-MM-dd') } : {}),
        note: this.note().trim() || undefined,
        items,
      })
      .subscribe({
        next: (res) => {
          this.messageService.add({
            severity: 'success',
            summary: '已開立帳單',
            detail: `${student.name} · ${this.total().toLocaleString('zh-TW')} 元`,
          });
          this.ref.close(res.data);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '開立失敗',
            detail: err.error?.error || '請稍後再試',
          });
          this.saving.set(false);
        },
      });
  }

  protected cancel(): void {
    this.ref.close();
  }
}
