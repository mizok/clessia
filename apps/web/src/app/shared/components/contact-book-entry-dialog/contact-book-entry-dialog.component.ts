import { DatePipe } from '@angular/common';
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
  imports: [DatePipe, StatusDotComponent, FormsModule, ButtonModule, TextareaModule],
  /**
   * `MessageService` 與 toast 出口都是全站一份（#1615，`app.config.ts`＋`App` 的 `<app-toast>`）。
   * 這裡原本自己帶一組（#733）：老師端整條路上沒有 provider 也沒有 `<p-toast>`，
   * 結果是 `NG0201`、補了 provider 之後又變成「儲存失敗」永遠看不見。全站一份之後兩個坑都不存在。
   */
  templateUrl: './contact-book-entry-dialog.component.html',
})
export class ContactBookEntryDialogComponent {
  private readonly service = inject(ContactBookService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  /**
   * 「這一則還沒有人寫」底下那句話要對誰說（#738）。
   *
   * 原本是無條件的「撰寫者本來是帶班老師 —— **這裡是行政的補寫入口**」。
   * `#737` 之前老師端打不開這支對話框，所以只有行政看得到、文案成立；
   * 路打通之後，**帶班老師看到的也是那一句**，而它對他是錯的。
   *
   * **預設刻意是中性版，不是沿用現狀的行政版** ——
   * 這跟 `login-link-dialog`（#666）相反，理由是失效方向：
   * 那一支的預設（家長版）對沒宣告的呼叫端是對的，
   * 這一支的預設（行政版）對沒宣告的呼叫端**可能是錯的**。
   * **將來多一個開啟點而有人忘了標，使用者該看到的是「少講一句」不是「講錯一句」。**
   */
  protected readonly emptyNote = () =>
    this.config.data?.audience === 'admin'
      ? '這一則還沒有人寫。撰寫者本來是帶班老師 —— 這裡是行政的補寫入口。'
      : '這一則還沒有人寫。';

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
