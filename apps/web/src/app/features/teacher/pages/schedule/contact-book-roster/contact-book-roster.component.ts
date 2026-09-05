import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import {
  ContactBookService,
  type MissingContactBookStudent,
} from '@core/contact-book.service';
import { ContactBookEntryDialogComponent } from '@shared/components/contact-book-entry-dialog/contact-book-entry-dialog.component';

/** 開這份名單需要的最小資料 —— 課堂卡上都有 */
export interface ContactBookRosterInput {
  readonly classId: string;
  readonly className: string;
  readonly entryDate: string;
}

/**
 * 老師端聯絡簿：**「今天這堂課還有誰沒寫」**。
 *
 * 設計見 `kb/wiki/architecture/teacher-contact-book.md`。
 * 只列還沒寫的那一半 —— 那是老師的實際問題，「列出全班」是我們以為他要的。
 * （`GET /api/contact-book` 沒有 `classId` 篩選，要完整名單得先開需求單。）
 */
@Component({
  selector: 'app-contact-book-roster',
  imports: [ButtonModule],
  templateUrl: './contact-book-roster.component.html',
  styleUrl: './contact-book-roster.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // **刻意不在這裡 provide DialogService** —— 這支自己是被 DialogService 開出來的，
  // 它從開啟方（課表頁）的 injector 拿到同一個實例。自己 provide 會多開一個，
  // 而且在測試裡會蓋掉注入的替身、把真的對話框實例化出來。
})
export class ContactBookRosterComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);
  private readonly contactBook = inject(ContactBookService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly input = this.config.data as ContactBookRosterInput;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly students = signal<MissingContactBookStudent[]>([]);
  /** 開啟某一列時的忙碌狀態 —— 開之前要先查那位學生今天有沒有已經被寫過 */
  protected readonly opening = signal<string | null>(null);
  protected readonly wroteAny = signal(false);

  protected readonly empty = computed(() => !this.loading() && this.students().length === 0);

  constructor() {
    this.load();
  }

  private load(): void {
    this.contactBook
      .missing(this.input.entryDate)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // `/missing` 回的是全部任課班的缺漏，這裡收斂到這一堂課的班
          this.students.set(
            res.data.filter((s) => s.classes.some((c) => c.classId === this.input.classId)),
          );
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  /**
   * **開之前先查一次那位學生當天的聯絡簿。**
   *
   * `/missing` 已經排除寫過的人，所以名單載入的那一刻是準的 —— 但它會過期：
   * 甲老師在名單載入之後才寫，這份清單仍然顯示那位學生。
   * 直接用 `draft` 開的話對話框是**空白的**，老師看不到甲寫了什麼，
   * 存檔就把它蓋掉（`PUT` 是 upsert），而且**兩邊都不會知道**。
   *
   * 一則一次往返，發生在真的要開的那一刻 —— 換掉的是「靜靜吃掉別人寫的東西」。
   */
  protected open(student: MissingContactBookStudent): void {
    if (this.opening()) return;
    this.opening.set(student.studentId);

    this.contactBook
      .list({ studentId: student.studentId, from: this.input.entryDate, to: this.input.entryDate })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.opening.set(null);
          // 有既有的就用 entry 開（對話框會預載內容並顯示「最後由 X 編輯」），
          // 沒有才是真的新寫
          const existing = res.data[0];
          const ref = this.dialogService.open(ContactBookEntryDialogComponent, {
            width: '480px',
            modal: true,
            showHeader: false,
            closable: false,
            styleClass: 'roster-sheet',
            data: existing
              ? { entry: existing }
              : {
                  draft: {
                    studentId: student.studentId,
                    studentName: student.studentName,
                    entryDate: this.input.entryDate,
                  },
                },
          });
          ref?.onClose.subscribe((saved?: unknown) => {
            if (!saved) return;
            this.wroteAny.set(true);
            this.students.update((list) => list.filter((s) => s.studentId !== student.studentId));
          });
        },
        error: () => {
          this.opening.set(null);
          this.loadError.set(true);
        },
      });
  }

  protected close(): void {
    this.ref.close(this.wroteAny());
  }
}
