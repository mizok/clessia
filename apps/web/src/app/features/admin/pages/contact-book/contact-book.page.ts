import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { OverlayContainerService } from '@core/overlay-container.service';
import {
  ContactBookService,
  type ContactBookEntry,
  type MissingContactBookStudent,
} from '@core/contact-book.service';
import { StudentsService, type Student } from '@core/students.service';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type {
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
} from '@shared/components/responsive-table/responsive-table.models';

import { ContactBookEntryDialogComponent } from './contact-book-entry-dialog/contact-book-entry-dialog.component';
import { dateRangeOf, signedSummary } from './contact-book.util';
import { StatusDotComponent } from '@shared/components/status/status-dot/status-dot.component';

const DEFAULT_RANGE_DAYS = 7;
const PAGE_SIZE = 15;

/**
 * 聯絡簿（管理端）—— 見 kb/wiki/rules/contact-book-rules.md 與
 * kb/wiki/architecture/admin-contact-book-page.md。
 *
 * **這一頁是監看不是撰寫。** rules 規則 4 指派給管理端的任務只有一句：
 * 「能看哪些還沒簽」。撰寫是帶班老師的工作流（老師端 P3）。
 *
 * **未簽收篩選與分頁都在前端做，而且是誠實的** —— `GET /api/contact-book` 沒有分頁，
 * 回的是符合日期區間的**全部**，所以手上的資料是完整的。
 * （對照 `/api/invoices`：那支有分頁，前端篩就只篩得到當頁，所以繳費頁沒有做狀態篩選。
 * 判斷「前端能不能篩」看的是資料完不完整，不是「前端篩」這個做法本身。）
 *
 * 量的控制靠日期區間，預設最近 7 天 —— 不給預設等於每次進頁全撈歷史。
 */
@Component({
  selector: 'app-admin-contact-book',
  standalone: true,
  imports: [
    StatusDotComponent,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    ToastModule,
    TooltipModule,
    EmptyStateComponent,
    StudentAutocompleteComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './contact-book.page.html',
  styleUrl: './contact-book.page.scss',
})
export class ContactBookPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly service = inject(ContactBookService);
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  private readonly today = format(new Date(), 'yyyy-MM-dd');

  protected readonly entries = signal<ContactBookEntry[]>([]);

  // ── 當日待辦：這天該寫但還沒寫的 ────────────────────────────────────────
  //
  // **跟下面的列表是兩個獨立的查詢，不共用日期。** 缺漏名單問的是「某一天」，
  // 列表問的是「一段區間」—— 綁在一起的話改區間結束日會同時動到兩件事。
  // 這個端點的消費場景是行政的當日待辦，所以它自己的預設就是今天。
  protected readonly missing = signal<MissingContactBookStudent[]>([]);
  protected readonly missingLoading = signal(true);
  protected readonly missingFailed = signal(false);
  protected missingDate: Date = new Date();
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  protected readonly unsignedOnly = signal(false);
  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly currentPage = signal(1);

  /** p-datepicker 的 range 模式給的是 `[start, end]`，end 在選第一個日期時是 null */
  protected dateRange: Date[] | null = initialRange(this.today);

  protected readonly selectedStudent = computed(() => {
    const value = this.student();
    return typeof value === 'string' || value === null ? null : value;
  });

  /** 三個數字算的是**日期區間內的全部**，不是當頁 —— 資料完整才敢這樣寫 */
  protected readonly summary = computed(() => signedSummary(this.entries()));

  protected readonly visibleEntries = computed(() =>
    this.unsignedOnly() ? this.entries().filter((entry) => !entry.isSigned) : this.entries(),
  );

  protected readonly pagedEntries = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleEntries().slice(start, start + PAGE_SIZE);
  });

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => ({
    first: Math.max((this.currentPage() - 1) * PAGE_SIZE, 0),
    rows: PAGE_SIZE,
    totalRecords: this.visibleEntries().length,
  }));

  protected readonly hasFilters = computed(
    () => this.unsignedOnly() || this.selectedStudent() !== null,
  );

  ngOnInit(): void {
    this.load();
    this.loadMissing();
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.currentPage.set(1);

    const [from, to] = rangeToStrings(this.dateRange, this.today);

    this.service.list({ studentId: this.selectedStudent()?.id, from, to }).subscribe({
      next: (res) => {
        this.entries.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.entries.set([]);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  /** 缺漏名單自己失敗就好 —— 它掛掉不該讓下面的歷史列表也看不了 */
  protected loadMissing(): void {
    this.missingLoading.set(true);
    this.missingFailed.set(false);

    this.service.missing(format(this.missingDate, 'yyyy-MM-dd')).subscribe({
      next: (res) => {
        this.missing.set(res.data);
        this.missingLoading.set(false);
      },
      error: () => {
        this.missing.set([]);
        this.missingFailed.set(true);
        this.missingLoading.set(false);
      },
    });
  }

  protected onMissingDateChange(value: Date | null): void {
    if (!value) return;
    this.missingDate = value;
    this.loadMissing();
  }

  /**
   * 從缺漏名單補寫一則。學生與日期都是清單給的 —— 不需要選擇器，
   * 所以這條路徑不違反「管理端不做挑學生開新一則」那個決定。
   */
  protected writeMissing(target: MissingContactBookStudent): void {
    const ref = this.dialogService.open(ContactBookEntryDialogComponent, {
      header: '補寫聯絡簿',
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        draft: {
          studentId: target.studentId,
          studentName: target.studentName,
          entryDate: format(this.missingDate, 'yyyy-MM-dd'),
        },
      },
    });

    ref?.onClose.subscribe((created: ContactBookEntry | undefined) => {
      if (!created) return;
      // 寫完就從待辦名單移掉，不重打整份名單
      this.missing.update((list) => list.filter((item) => item.studentId !== created.studentId));
      // 新寫的那則若落在列表的區間內就該出現 —— 這裡重打列表比自己插入可靠
      this.load();
    });
  }

  protected classNamesOf(target: MissingContactBookStudent): string {
    return target.classes.map((c) => c.className).join('、');
  }

  protected onDateRangeChange(value: Date[] | null): void {
    this.dateRange = value;
    // range 模式在選第一個日期時 end 還是 null —— 那時候查會查成單日，等選完再查
    if (!value || value.length < 2 || !value[1]) return;
    this.load();
  }

  protected onStudentChange(value: Student | string | null): void {
    this.student.set(value);
    // 打字中間是字串，還不是選定的學生
    if (typeof value !== 'string') this.load();
  }

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

  /** 未簽收是**前端篩**，資料沒變，不必重打 API —— 只要回到第一頁 */
  protected toggleUnsignedOnly(): void {
    this.unsignedOnly.update((v) => !v);
    this.currentPage.set(1);
  }

  protected clearFilters(): void {
    this.unsignedOnly.set(false);
    this.student.set(null);
    this.studentSuggestions.set([]);
    this.dateRange = initialRange(this.today);
    this.load();
  }

  protected onPageChange(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(Math.floor(event.first / PAGE_SIZE) + 1);
  }

  protected openEntry(entry: ContactBookEntry): void {
    const ref = this.dialogService.open(ContactBookEntryDialogComponent, {
      header: '聯絡簿內容',
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { entry },
    });

    ref?.onClose.subscribe((updated: ContactBookEntry | undefined) => {
      if (!updated) return;
      // 換掉手上那一筆就好 —— 重打 API 會讓整張表閃一次，而 upsert 回的就是最新的它
      this.entries.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
    });
  }
}

/** 預設最近 7 天（含今天） */
function initialRange(today: string): Date[] {
  const { from, to } = dateRangeOf(DEFAULT_RANGE_DAYS, today);
  return [new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`)];
}

/**
 * 沒選滿區間就退回預設的 7 天 —— 不帶 `from`/`to` 會讓後端全撈歷史，
 * 而這支 API 沒有分頁擋著。
 */
function rangeToStrings(range: Date[] | null, today: string): [string, string] {
  if (!range || range.length < 2 || !range[0] || !range[1]) {
    const fallback = dateRangeOf(DEFAULT_RANGE_DAYS, today);
    return [fallback.from, fallback.to];
  }

  return [format(range[0], 'yyyy-MM-dd'), format(range[1], 'yyyy-MM-dd')];
}
