import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ContactBookService, type ContactBookEntry } from '@core/contact-book.service';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

/** 補寫一則時需要的最小資料 —— 學生與日期由缺漏清單給，不讓使用者挑 */
export interface EntryDraft {
  studentId: string;
  studentName: string;
  entryDate: string;
}

/** 後端的 `content` 上限是 5000（`UpsertSchema`），前端擋在同一個數字上 */
const MAX_CONTENT = 5000;

/**
 * 看／改一則聯絡簿，或補寫缺漏名單上的一則。
 *
 * 兩種進入方式，送的是同一支 upsert：
 * - `{ entry }` —— 從列表點一則既有的進來
 * - `{ draft: { studentId, studentName, entryDate } }` —— 從「還沒寫」清單點進來
 *
 * **兩種都不給學生／日期選擇器**：那兩個是 upsert 的鍵（`student_id, entry_date`），
 * 改掉等於在別的位置開一則新的、而原本那則還留著。學生與日期永遠由呼叫端決定 ——
 * 這也是為什麼管理端沒有「自己挑學生開一則」的入口（那是老師端的工作流），
 * 但從缺漏清單補寫是合理的：學生與日期都是清單給的，不需要任何選擇器。
 *
 * 共同編輯照 rules 3：直接覆寫同一列並換掉 `last_edited_by`，不做分段作者。
 * 所以這裡沒有衝突偵測 —— 後寫的贏是規則說好的行為，不是遺漏。
 */
@Component({
  selector: 'app-contact-book-entry-dialog',
  standalone: true,
  imports: [StatusDotComponent, FormsModule, ButtonModule, TextareaModule],
  templateUrl: './contact-book-entry-dialog.component.html',
  styleUrl: './contact-book-entry-dialog.component.scss',
})
export class ContactBookEntryDialogComponent {
  private readonly service = inject(ContactBookService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  protected readonly MAX_CONTENT = MAX_CONTENT;

  /** 既有的一則；補寫時是 null */
  protected readonly entry = signal<ContactBookEntry | null>(this.config.data.entry ?? null);
  /** 補寫時的學生與日期。與 `entry` 恰有一個是 null */
  protected readonly draft = signal<EntryDraft | null>(this.config.data.draft ?? null);

  protected readonly content = signal(this.config.data.entry?.content ?? '');
  protected readonly saving = signal(false);

  protected readonly isNew = computed(() => this.entry() === null);
  protected readonly studentName = computed(
    () => this.entry()?.studentName ?? this.draft()?.studentName ?? '未知學生',
  );
  protected readonly entryDate = computed(
    () => this.entry()?.entryDate ?? this.draft()?.entryDate ?? '',
  );

  /** 補寫時只要有字就算 dirty —— 沒有「原本的內容」可以比 */
  protected readonly dirty = computed(() => {
    const original = this.entry()?.content ?? '';
    return this.content().trim() !== original;
  });

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
        studentId: this.entry()?.studentId ?? this.draft()!.studentId,
        entryDate: this.entryDate(),
        content,
      })
      .subscribe({
        next: (updated) => {
          this.messageService.add({
            severity: 'success',
            summary: this.isNew() ? '已寫入' : '已儲存',
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
