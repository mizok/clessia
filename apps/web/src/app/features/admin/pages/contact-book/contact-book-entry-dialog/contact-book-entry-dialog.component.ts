import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ContactBookService, type ContactBookEntry } from '@core/contact-book.service';

/** 後端的 `content` 上限是 5000（`UpsertSchema`），前端擋在同一個數字上 */
const MAX_CONTENT = 5000;

/**
 * 看／改一則聯絡簿。
 *
 * **只能改內容**，不能改學生或日期 —— 那兩個是 upsert 的鍵（`student_id, entry_date`），
 * 改掉等於在別的位置開一則新的、而原本那則還留著。要換人換日子就是另一則。
 *
 * 共同編輯照 rules 3：直接覆寫同一列並換掉 `last_edited_by`，不做分段作者。
 * 所以這裡沒有衝突偵測 —— 後寫的贏是規則說好的行為，不是遺漏。
 */
@Component({
  selector: 'app-contact-book-entry-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, TagModule, TextareaModule],
  templateUrl: './contact-book-entry-dialog.component.html',
  styleUrl: './contact-book-entry-dialog.component.scss',
})
export class ContactBookEntryDialogComponent {
  private readonly service = inject(ContactBookService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly MAX_CONTENT = MAX_CONTENT;

  protected readonly entry = signal<ContactBookEntry>(this.config.data.entry);
  protected readonly content = signal(this.config.data.entry.content);
  protected readonly saving = signal(false);

  protected readonly dirty = computed(() => this.content().trim() !== this.entry().content);

  protected save(): void {
    const content = this.content().trim();

    if (!content) {
      this.messageService.add({
        severity: 'warn',
        summary: '內容不能空白',
        detail: '要清掉這則聯絡簿請找老師處理，不是存一個空的',
      });
      return;
    }

    this.saving.set(true);
    this.service
      .upsert({
        studentId: this.entry().studentId,
        entryDate: this.entry().entryDate,
        content,
      })
      .subscribe({
        next: (updated) => {
          this.messageService.add({
            severity: 'success',
            summary: '已儲存',
            detail: `${updated.studentName ?? ''} ${updated.entryDate} 的聯絡簿已更新`,
          });
          // 這支回的是裸的 entry，不是 { data } —— 直接就是最新的它
          this.ref.close(updated);
        },
        error: (err) => {
          this.messageService.add({
            severity: 'error',
            summary: '儲存失敗',
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
