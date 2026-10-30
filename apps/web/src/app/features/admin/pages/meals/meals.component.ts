import { TextSwapDirective } from '@shared/directives/text-swap.directive';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, of, switchMap } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { OverlayContainerService } from '@core/overlay-container.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { MealsService, MEAL_BATCH_MAX_ROWS, type MealSummary } from '@core/meals.service';
import { StudentsService, type Student } from '@core/students.service';

import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';

import {
  BillingRunDialogComponent,
  type BillingRunDialogData,
} from './billing-run-dialog/billing-run-dialog.component';
import {
  changedCount,
  chapterOrdered,
  draftSnapshot,
  draftTotals,
  monthDay,
  draftToBatchRows,
  mealChapters,
  mealDayChapters,
  rosterToDraft,
  unhandledCount,
  weekdayLabel,
  type MealDraftRow,
} from './meals.util';
import type { StatusTone } from '@shared/components/status/status-dot/status-dot.component';
import { SystemClockService } from '@core/system-clock.service';
import { extractErrorMessage } from '@shared/utils/api-error.util';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

/** 區間模式的每頁筆數。後端 pageSize 上限 100 */
const RANGE_PAGE_SIZE = 50;

/**
 * 餐費管理 —— 見 kb/wiki/rules/meal-rules.md 與 kb/wiki/specs/admin/finance/meals.md。
 *
 * **每日名單勾選，不是逐筆記帳。** 課表產生候選名單（今天有課的學生），
 * 學生的 `mealDefault` 決定誰預設勾起，行政確認後寫成 `meal_records`。
 *
 * **「收不收費」是人工開關不是規則**（規則 3）：「便當已經送到了才請假」那種狀況
 * 是人工裁量 —— 這裡**沒有任何自動化的截止時間邏輯**，只有一個行政可以翻的開關。
 *
 * **兩種檢視，只有單日能編輯。** 單日模式回的是「課表候選 + 既有記錄」；區間模式
 * 只回**實際存在的餐記錄**，`classNames` 是空的、`mealDefault` 是 false ——
 * 後端刻意的不對稱（要知道三個月前某天誰「應該」訂餐得把當天課表重推一次）。
 * 而且 `POST /batch` 吃的是**單一 date**，跨天的修改沒有對應的端點。
 * 所以區間是**唯讀檢視**：欄位全部 disabled，沒有確認按鈕。
 *
 * **已結算的列鎖住。** 結算後改收費會讓已開出的帳單金額對不上；要改得走帳單作廢
 * （item 刪除 → FK SET NULL 自動解除標記）或下期 adjustment。後端也擋，
 * 而且會回 `lockedStudentIds` —— 那個要顯示出來，行政才知道哪幾筆沒改到。
 */
@Component({
  selector: 'app-admin-meals',
  standalone: true,
  imports: [
    TextSwapDirective,
    SkeletonComponent,
    PageOpenComponent,
    DecimalPipe,
    RouterLink,
    FormsModule,
    ButtonModule,
    TooltipModule,
    PageActionsComponent,
    EmptyStateComponent,
    StudentAutocompleteComponent,
  ],
  providers: [DialogService],
  templateUrl: './meals.component.html',
})
export class MealsComponent implements OnInit {
  readonly page = input.required<RouteObj>();
  /**
   * 儀表板「待開單」卡片帶過來的（#1293）：`?billingRun=period&periodId=…` 一進頁就打開開單 dialog、
   * 選好那一期 —— 卡片說的那一期就是點進去開的那一期（admin-todo-alerts P1-6）
   */
  readonly billingRun = input<string | undefined>();
  readonly periodId = input<string | undefined>();

  private readonly clock = inject(SystemClockService);
  private readonly service = inject(MealsService);
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly MEAL_BATCH_MAX_ROWS = MEAL_BATCH_MAX_ROWS;
  protected readonly primaryAction: PageAction = { label: '月結' };

  protected readonly modeOptions = [
    { value: 'day' as const, label: '當日名單' },
    { value: 'range' as const, label: '區間查詢' },
  ];

  protected readonly rows = signal<MealDraftRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal(false);
  protected readonly defaultUnitPrice = signal(0);
  protected readonly summary = signal<MealSummary | null>(null);

  /** `day` 可編輯、`range` 唯讀 —— 見類別註解 */
  protected readonly mode = signal<'day' | 'range'>('day');
  protected readonly isRange = computed(() => this.mode() === 'range');

  /**
   * **這一次實際送出去的區間**（#710）。
   *
   * 空狀態要講的是「剛才查了什麼」，所以記的是 `load()` 當下送出去的那一組，
   * 不是 `dateFrom`／`dateTo` 即時的值 —— 兩者只在載入途中不同，但空狀態只在載完後才畫。
   */
  protected readonly queriedRange = signal<{ dateFrom: string; dateTo: string } | null>(null);

  /** 名單日期，`YYYY-MM-DD`（台北）。**字串，不經 `new Date()`** —— 原生日期欄給的就是這個形狀 */
  protected readonly dateStr = signal(this.clock.todayTaipei());
  /** 區間起訖，`YYYY-MM-DD`（台北）。跟名單日期一樣是字串、不經 `new Date()` */
  protected readonly dateFrom = signal('');
  protected readonly dateTo = signal('');
  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly currentPage = signal(1);

  protected readonly selectedStudent = computed(() => {
    const value = this.student();
    return typeof value === 'string' || value === null ? null : value;
  });

  protected readonly pagination = computed(() => ({
    first: Math.max((this.currentPage() - 1) * RANGE_PAGE_SIZE, 0),
    rows: RANGE_PAGE_SIZE,
    totalRecords: this.summary()?.total ?? 0,
  }));
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.pagination().totalRecords / RANGE_PAGE_SIZE)),
  );

  protected readonly totals = computed(() => draftTotals(this.rows()));
  /**
   * 色面句（A6）。當日：「今天 N 份便當，／還有 M 位沒處理。」（不是今天就把「今天」換成 M/D）；
   * 區間：「9/1–10/1／N 份便當，NT$ X。」數字取後端的 meta。還沒載到、失敗、空名單回 `null`，退回頁名。
   * 「沒處理」＝這天還沒有記錄的人（`recordId === null`），跟「收不收費」的開關無關。
   */
  protected readonly headline = computed<{ first: string; second: string } | null>(() => {
    if (this.loading() || this.failed() || this.rows().length === 0) return null;
    if (this.isRange()) {
      const range = this.queriedRange();
      const meta = this.summary();
      if (!range || !meta) return null;
      return {
        first: `${monthDay(range.dateFrom)}–${monthDay(range.dateTo)}`,
        second: `${meta.total} 份便當，NT$ ${meta.totalAmount.toLocaleString('en-US')}。`,
      };
    }
    const day = this.dateStr() === this.clock.todayTaipei() ? '今天' : monthDay(this.dateStr());
    const unhandled = this.rows().filter((row) => row.recordId === null).length;
    return {
      first: `${day} ${this.totals().ordered} 份便當，`,
      second: unhandled > 0 ? `還有 ${unhandled} 位沒處理。` : '全部處理完了。',
    };
  });
  protected readonly chapterOrdered = chapterOrdered;
  protected readonly weekdayLabel = weekdayLabel;
  protected readonly monthDay = monthDay;
  /** 當日依班分章；區間依日期分章（A6 `.chap`），章內的列各自寫在模板的兩個 @if 裡 */
  protected readonly classChapters = computed(() => mealChapters(this.rows()));
  protected readonly dayChapters = computed(() => mealDayChapters(this.rows()));
  protected readonly chapterGrid = 'wide:grid-cols-[13rem_minmax(0,1fr)] wide:gap-8';

  /**
   * 載入當下的快照。確認列只在「改了」或「還有人沒處理」時出現（A6）：
   * 沒處理的列帶的是預設值、沒人動過也一樣要能確認，所以不能只看 diff。
   */
  private readonly baseline = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly changed = computed(() => changedCount(this.rows(), this.baseline()));
  protected readonly unhandled = computed(() => unhandledCount(this.rows()));
  protected readonly showSaveBar = computed(() => this.changed() > 0 || this.unhandled() > 0);
  protected readonly settledCount = computed(() => this.rows().filter((r) => r.settled).length);
  /** 超過後端上限就擋在送出之前 —— 靜靜截斷會讓一部分學生沒有記錄 */
  protected readonly overBatchLimit = computed(
    () => draftToBatchRows(this.rows()).length > MEAL_BATCH_MAX_ROWS,
  );

  /**
   * 載入走 switchMap：連切日期／起訖／分頁、或存完立刻重載時，**後發的蓋掉先發的**，
   * 慢回來的舊回應不會把畫面換回舊日期的名單（那份名單還能被「確認名單」寫進新日期之外的資料）。
   */
  private readonly loadRequest$ = new Subject<ReturnType<MealsService['roster']>>();

  constructor() {
    this.loadRequest$
      .pipe(
        switchMap((request) => request.pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        if (!res) {
          this.rows.set([]);
          this.summary.set(null);
          this.failed.set(true);
          this.loading.set(false);
          return;
        }
        this.defaultUnitPrice.set(res.defaultUnitPrice);
        const draft = rosterToDraft(res.data, res.defaultUnitPrice);
        this.rows.set(draft);
        this.baseline.set(draftSnapshot(draft));
        this.summary.set(res.meta);
        this.loading.set(false);
      });
  }

  ngOnInit(): void {
    if (this.billingRun() === 'period') {
      this.openBillingRun({ mode: 'period', periodId: this.periodId() });
    }
    this.load();
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  private get dateString(): string {
    return this.dateStr();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    let request;
    if (this.isRange()) {
      const range = { dateFrom: this.dateFrom(), dateTo: this.dateTo() };
      // 跟送出去的是同一個物件 —— 這樣空狀態上的日期不可能跟查詢漂掉
      this.queriedRange.set(range);
      request = this.service.range({
        ...range,
        studentId: this.selectedStudent()?.id,
        page: this.currentPage(),
        pageSize: RANGE_PAGE_SIZE,
      });
    } else {
      this.queriedRange.set(null);
      request = this.service.roster(this.dateString);
    }

    this.loadRequest$.next(request);
  }

  /**
   * 原生日期欄的 `change`。**空值（清掉、或只打了一半）要把欄位還原成目前的日期** ——
   * 否則畫面上的欄位是空的、底下卻還是上一天的名單。
   */
  protected onDateInput(input: HTMLInputElement): void {
    if (!input.value) {
      input.value = this.dateStr();
      return;
    }
    this.onDateChange(input.value);
  }

  protected onDateChange(value: string): void {
    if (!value) return;
    this.dateStr.set(value);
    this.load();
  }

  protected switchMode(mode: 'day' | 'range'): void {
    if (this.mode() === mode) return;
    this.mode.set(mode);
    this.currentPage.set(1);
    // 切到區間時給一個預設區間 —— 不給的話後端會回 400
    if (mode === 'range' && !this.dateFrom()) {
      this.dateFrom.set(`${this.dateStr().slice(0, 7)}-01`);
      this.dateTo.set(this.dateStr());
    }
    this.load();
  }

  /**
   * 區間起訖的原生日期欄。空值要還原成目前的值；起日晚於迄日時，把另一端拉到同一天
   * （起訖同一天是合法的單日區間）。
   */
  protected onFromInput(input: HTMLInputElement): void {
    if (!input.value) {
      input.value = this.dateFrom();
      return;
    }
    this.dateFrom.set(input.value);
    if (input.value > this.dateTo()) this.dateTo.set(input.value);
    this.currentPage.set(1);
    this.load();
  }

  protected onToInput(input: HTMLInputElement): void {
    if (!input.value) {
      input.value = this.dateTo();
      return;
    }
    this.dateTo.set(input.value);
    if (input.value < this.dateFrom()) this.dateFrom.set(input.value);
    this.currentPage.set(1);
    this.load();
  }

  /** 單價原生輸入框：只收非負整數；清空或亂打就還原成目前的單價（不送 null 給後端） */
  protected onPriceInput(row: MealDraftRow, input: HTMLInputElement): void {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) {
      input.value = String(row.unitPrice);
      return;
    }
    const price = Number(digits);
    input.value = String(price);
    this.updateRow(row.studentId, 'unitPrice', price);
  }

  protected onStudentChange(value: Student | string | null): void {
    this.student.set(value);
    if (typeof value === 'string') return;
    this.currentPage.set(1);
    this.load();
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

  protected goPage(delta: -1 | 1): void {
    const next = this.currentPage() + delta;
    if (next < 1 || next > this.totalPages()) return;
    this.currentPage.set(next);
    this.load();
  }

  protected updateRow<K extends keyof MealDraftRow>(
    studentId: string,
    field: K,
    value: MealDraftRow[K],
  ): void {
    this.rows.update((list) =>
      list.map((row) => (row.studentId === studentId ? { ...row, [field]: value } : row)),
    );
  }

  /** 全部勾／全部不勾。已結算的不動 —— 它們鎖住了 */
  protected setAllOrdered(ordered: boolean): void {
    this.rows.update((list) => list.map((row) => (row.settled ? row : { ...row, ordered })));
  }

  protected save(): void {
    const batchRows = draftToBatchRows(this.rows());

    if (batchRows.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: '沒有可以寫入的列',
        detail: '這天的名單全部已結算，或候選名單是空的',
      });
      return;
    }

    if (batchRows.length > MEAL_BATCH_MAX_ROWS) {
      this.messageService.add({
        severity: 'warn',
        summary: '一次寫不了這麼多',
        detail: `後端一次最多 ${MEAL_BATCH_MAX_ROWS} 筆，這天有 ${batchRows.length} 位。請回報，別讓它靜靜少寫`,
      });
      return;
    }

    this.saving.set(true);
    this.service.batch(this.dateString, batchRows).subscribe({
      next: (res) => {
        this.saving.set(false);

        // 被鎖住而沒寫進去的要講出來 —— 不然行政以為改成功了
        if (res.lockedStudentIds.length > 0) {
          const names = this.rows()
            .filter((row) => res.lockedStudentIds.includes(row.studentId))
            .map((row) => row.studentName)
            .join('、');
          this.messageService.add({
            severity: 'warn',
            summary: `已寫入 ${res.updated} 筆，${res.lockedStudentIds.length} 筆沒改到`,
            detail: `${names} 已經結算，要改得走帳單作廢或下期調整`,
            life: 8000,
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: '名單已確認',
            detail: `${this.dateString} 寫入 ${res.updated} 筆`,
          });
        }

        // 重新取數：settled 與 recordId 由後端決定，不要自己猜
        this.load();
      },
      error: (err) => {
        // extractErrorMessage() 接三種形狀：這個專案自己的 { error: string } 慣例、
        // Zod 驗證失敗的巢狀物件 { error: { message } }、以及完全沒回 JSON 的情況 ——
        // 單純 typeof 檢查只接得住第一種，Zod 那條路徑照樣會塞出 [object Object]。
        this.messageService.add({
          severity: 'error',
          summary: '名單沒有確認',
          detail: extractErrorMessage(err, '請稍後再試，或聯絡系統管理員'),
          // 失敗訊息不能幾秒後自己消失——使用者要有時間看到並決定要不要重試
          sticky: true,
        });
        this.saving.set(false);
      },
    });
  }

  protected openBillingRun(data: BillingRunDialogData = {}): void {
    const ref = this.dialogService.open(BillingRunDialogComponent, {
      data,
      width: '520px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });

    // 月結會把這天的餐記錄蓋上結算標記 —— 跑完重新取數才看得到鎖
    ref?.onClose.subscribe((ran: boolean | undefined) => {
      if (ran) this.load();
    });
  }
  /**
   * 「未處理」= 這天還沒有人決定要不要收費（`recordId === null`）。
   *
   * **有時間維度**：那天還沒過就只是還沒輪到（pending），過完了還沒處理才是名單漏了
   * （overdue）。時點是**那一天結束**。
   *
   * ⚠️ **這跟「收不收費」的開關是兩件事，不要混。** `meal-rules` 規則 3 明文
   * 「不要自動化 N 點截止邏輯 —— 那是人工裁量」，所以那顆開關**永遠不能有 overdue**。
   * 這裡判斷的是「行政有沒有處理過這一列」，不是「這一餐該不該收錢」。
   */
  protected unhandledTone(): StatusTone {
    return this.dateString < this.clock.todayTaipei() ? 'overdue' : 'pending';
  }
}
