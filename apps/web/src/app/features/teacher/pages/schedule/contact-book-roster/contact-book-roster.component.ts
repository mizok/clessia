import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { AuthService } from '@core/auth.service';
import { ContactBookService, type ContactBookEntry } from '@core/contact-book.service';
import { SystemClockService } from '@core/system-clock.service';
import { ContactBookEntryDialogComponent } from '@shared/components/contact-book-entry-dialog/contact-book-entry-dialog.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { DialogFrameComponent } from '@shared/components/dialog-frame/dialog-frame.component';

/** 開這份名單需要的最小資料 —— 課堂卡上都有 */
export interface ContactBookRosterInput {
  readonly classId: string;
  readonly className: string;
  readonly entryDate: string;
}

/** 名單的一列：還沒寫的 `entry` 是 null */
export interface ContactBookRosterRow {
  readonly studentId: string;
  readonly studentName: string;
  readonly entry: ContactBookEntry | null;
}

/**
 * 老師端聯絡簿：**還沒寫的在上面，寫好的留在下面**（#2499）。
 *
 * 設計見 `kb/wiki/architecture/teacher-contact-book.md`。原本只列還沒寫的那一半，寫完那列就消失，
 * 老師看不到也改不了自己剛寫的（#2494 第三輪走查）。現在：
 * - 還沒寫：`/missing`（伺服器算的差集），收斂到這一堂課的班
 * - 已寫：當天的聯絡簿（`GET /api/contact-book?from=&to=`）裡、班名含這一班的。
 *   ponytail: 那支沒有 classId 篩選，用班名對 —— 列上的班名只含老師現任、開了聯絡簿的班，
 *   同一位老師兩個同名的班才會混；真的撞到再給列表加 classId
 * - 「修改」只給**自己寫的、當天的**那一則（伺服器同一條，PUT 403 `CONTACT_BOOK_NOT_EDITABLE`）；
 *   其餘已寫的唯讀，寫明是誰寫的
 */
@Component({
  selector: 'app-contact-book-roster',
  imports: [DialogFrameComponent, SkeletonComponent, ButtonModule],
  templateUrl: './contact-book-roster.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // **刻意不在這裡 provide DialogService** —— 這支自己是被 DialogService 開出來的，
  // 它從開啟方（課表頁）的 injector 拿到同一個實例。自己 provide 會多開一個，
  // 而且在測試裡會蓋掉注入的替身、把真的對話框實例化出來。
})
export class ContactBookRosterComponent {
  private readonly config = inject(DynamicDialogConfig);
  /** 列表增刪的頁內 VT（#1641 項 5）：新列淡入、刪掉的淡出、其餘補位 */
  private readonly viewTransition = injectViewTransition();
  private readonly ref = inject(DynamicDialogRef);
  private readonly contactBook = inject(ContactBookService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly clock = inject(SystemClockService);

  protected readonly input = this.config.data as ContactBookRosterInput;

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly rows = signal<ContactBookRosterRow[]>([]);
  /** 開啟某一列時的忙碌狀態 —— 開之前要先查那位學生今天有沒有已經被寫過 */
  protected readonly opening = signal<string | null>(null);
  protected readonly wroteAny = signal(false);

  /** 還沒寫的在前、寫好的在後（A6 只畫還沒寫的那一半，已寫的接在後面：R5） */
  protected readonly ordered = computed(() => [
    ...this.rows().filter((r) => !r.entry),
    ...this.rows().filter((r) => r.entry),
  ]);
  protected readonly empty = computed(
    () => !this.loading() && this.rows().every((r) => r.entry !== null),
  );

  constructor() {
    this.load();
  }

  private load(): void {
    const date = this.input.entryDate;
    forkJoin([this.contactBook.missing(date), this.contactBook.list({ from: date, to: date })])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([missing, written]) => {
          // `/missing` 回的是全部任課班的缺漏，這裡收斂到這一堂課的班
          const todo = missing.data
            .filter((s) => s.classes.some((c) => c.classId === this.input.classId))
            .map((s) => ({ studentId: s.studentId, studentName: s.studentName, entry: null }));
          const done = written.data
            .filter((e) => e.classNames.includes(this.input.className))
            .map((e) => ({ studentId: e.studentId, studentName: e.studentName ?? '', entry: e }));
          this.rows.set([...todo, ...done]);
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  /** 自己寫的、當天的才能改（伺服器同一條） */
  protected canEdit(entry: ContactBookEntry): boolean {
    return (
      entry.lastEditedBy === this.auth.user()?.id &&
      this.input.entryDate === this.clock.todayTaipei()
    );
  }

  private setEntry(studentId: string, entry: ContactBookEntry): void {
    this.viewTransition(
      () =>
        this.rows.update((list) =>
          list.map((r) => (r.studentId === studentId ? { ...r, entry } : r)),
        ),
      { rows: true },
    );
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
  protected open(row: ContactBookRosterRow): void {
    if (this.opening()) return;
    // 已寫的那列按「修改」：手上就是那一則
    if (row.entry) {
      this.openDialog(row.studentId, { entry: row.entry });
      return;
    }
    this.opening.set(row.studentId);

    this.contactBook
      .list({ studentId: row.studentId, from: this.input.entryDate, to: this.input.entryDate })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.opening.set(null);
          // 有既有的就用 entry 開（對話框會預載內容並顯示「最後由 X 編輯」），沒有才是真的新寫。
          // 既有的是別人寫的（或不是今天）就改不了 —— 不開，讓那列變成已寫、寫明是誰（#2499）
          const existing = res.data[0];
          if (existing && !this.canEdit(existing)) {
            this.setEntry(row.studentId, existing);
            return;
          }
          this.openDialog(
            row.studentId,
            existing
              ? { entry: existing }
              : {
                  draft: {
                    studentId: row.studentId,
                    studentName: row.studentName,
                    entryDate: this.input.entryDate,
                  },
                },
          );
        },
        error: () => {
          this.opening.set(null);
          this.loadError.set(true);
        },
      });
  }

  private openDialog(studentId: string, data: unknown): void {
    const ref = this.dialogService.open(ContactBookEntryDialogComponent, {
      width: 'var(--dlg-w-md)',
      modal: true,
      showHeader: false,
      closable: false,
      styleClass: 'roster-sheet',
      data,
    });
    ref?.onClose.subscribe((saved?: ContactBookEntry) => {
      if (!saved) return;
      this.wroteAny.set(true);
      this.setEntry(studentId, saved);
    });
  }

  protected close(): void {
    this.ref.close(this.wroteAny());
  }
}
