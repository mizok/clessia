import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { format, startOfMonth } from 'date-fns';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToastModule } from 'primeng/toast';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { OverlayContainerService } from '@core/overlay-container.service';
import { MealsService, MEAL_BATCH_MAX_ROWS, type MealSummary } from '@core/meals.service';
import { StudentsService, type Student } from '@core/students.service';

import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
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

import { BillingRunDialogComponent } from './billing-run-dialog/billing-run-dialog.component';
import { draftTotals, draftToBatchRows, rosterToDraft, type MealDraftRow } from './meals.util';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';
import { todayLocal } from '@shared/utils/session-time.util';

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
    StatusDotComponent,
    DecimalPipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    SelectButtonModule,
    ToastModule,
    ToggleSwitchModule,
    TooltipModule,
    PageActionsComponent,
    EmptyStateComponent,
    StudentAutocompleteComponent,
    ResponsiveTableComponent,
    RtColDefDirective,
    RtColCellDirective,
    RtRowDirective,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './meals.component.html',
  styleUrl: './meals.component.scss',
})
export class MealsComponent implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly service = inject(MealsService);
  private readonly studentsService = inject(StudentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);

  protected readonly MEAL_BATCH_MAX_ROWS = MEAL_BATCH_MAX_ROWS;
  protected readonly primaryAction: PageAction = { label: '月結', icon: 'pi pi-calculator' };

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

  protected date: Date = new Date();
  protected dateRange: Date[] | null = null;
  protected readonly student = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  protected readonly currentPage = signal(1);

  protected readonly selectedStudent = computed(() => {
    const value = this.student();
    return typeof value === 'string' || value === null ? null : value;
  });

  protected readonly pagination = computed<ResponsiveTablePaginationConfig>(() => {
    const meta = this.summary();
    return {
      first: Math.max((this.currentPage() - 1) * RANGE_PAGE_SIZE, 0),
      rows: RANGE_PAGE_SIZE,
      totalRecords: meta?.total ?? 0,
    };
  });

  protected readonly totals = computed(() => draftTotals(this.rows()));
  protected readonly settledCount = computed(() => this.rows().filter((r) => r.settled).length);
  /** 超過後端上限就擋在送出之前 —— 靜靜截斷會讓一部分學生沒有記錄 */
  protected readonly overBatchLimit = computed(
    () => draftToBatchRows(this.rows()).length > MEAL_BATCH_MAX_ROWS,
  );

  ngOnInit(): void {
    this.load();
  }

  private get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  private get dateString(): string {
    return format(this.date, 'yyyy-MM-dd');
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    const request = this.isRange()
      ? this.service.range({
          ...rangeToStrings(this.dateRange, this.dateString),
          studentId: this.selectedStudent()?.id,
          page: this.currentPage(),
          pageSize: RANGE_PAGE_SIZE,
        })
      : this.service.roster(this.dateString);

    request.subscribe({
      next: (res) => {
        this.defaultUnitPrice.set(res.defaultUnitPrice);
        this.rows.set(rosterToDraft(res.data, res.defaultUnitPrice));
        this.summary.set(res.meta);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.summary.set(null);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected onDateChange(value: Date | null): void {
    if (!value) return;
    this.date = value;
    this.load();
  }

  protected switchMode(mode: 'day' | 'range'): void {
    if (this.mode() === mode) return;
    this.mode.set(mode);
    this.currentPage.set(1);
    // 切到區間時給一個預設區間 —— 不給的話後端會回 400
    if (mode === 'range' && !this.dateRange) {
      this.dateRange = [startOfMonth(this.date), this.date];
    }
    this.load();
  }

  protected onRangeChange(value: Date[] | null): void {
    this.dateRange = value;
    // range 模式選第一個日期時 end 還是 null，那時候查會查成單日
    if (!value || value.length < 2 || !value[1]) return;
    this.currentPage.set(1);
    this.load();
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

  protected onPageChange(event: ResponsiveTablePageEvent): void {
    this.currentPage.set(Math.floor(event.first / RANGE_PAGE_SIZE) + 1);
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
        this.messageService.add({
          severity: 'error',
          summary: '寫入失敗',
          detail: err.error?.error || '請稍後再試',
        });
        this.saving.set(false);
      },
    });
  }

  protected openBillingRun(): void {
    const ref = this.dialogService.open(BillingRunDialogComponent, {
      header: '月結',
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
  protected unhandledTone(now: Date = new Date()): StatusTone {
    return this.dateString < todayLocal(now) ? 'overdue' : 'pending';
  }
}

/** 沒選滿區間就退回「這個月到今天」—— 不帶區間後端會回 400 */
function rangeToStrings(
  range: Date[] | null,
  fallbackDate: string,
): { dateFrom: string; dateTo: string } {
  if (!range || range.length < 2 || !range[0] || !range[1]) {
    return { dateFrom: `${fallbackDate.slice(0, 7)}-01`, dateTo: fallbackDate };
  }

  return {
    dateFrom: format(range[0], 'yyyy-MM-dd'),
    dateTo: format(range[1], 'yyyy-MM-dd'),
  };
}
