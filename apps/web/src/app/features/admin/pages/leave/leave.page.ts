import { Component, DestroyRef, OnInit, inject, signal, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService, ConfirmEventType } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { format, differenceInCalendarDays } from 'date-fns';
import { skip } from 'rxjs';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { CampusContextService } from '@core/campus-context.service';
import { CampusScopeNoteComponent } from '@shared/components/campus-scope-note/campus-scope-note.component';
import {
  SystemClockService,
  addDaysToDateString,
  taipeiDateString,
} from '@core/system-clock.service';
import { StudentsService, type Student } from '@core/students.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { LeaveFormDialogComponent } from './leave-form-dialog.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';

@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [
    CampusScopeNoteComponent,
    PageOpenComponent,
    PageActionsComponent,
    ChapterHeadComponent,
    StudentAutocompleteComponent,
    RouterLink,
    FormsModule,
    ButtonModule,
    DatePickerModule,
    ToastModule,
    TooltipModule,
    ConfirmDialogModule,
    DynamicDialogModule,
  ],
  providers: [MessageService, ConfirmationService, DialogService],
  templateUrl: './leave.page.html',
})
export class LeavePage implements OnInit {
  /** 主要行動。**寫成 readonly property 不是模板裡的物件字面量** ——
   *  字面量每輪變更偵測都會產生新物件，讓 signal input 每次都判定為「變了」。 */
  protected readonly primaryAction: PageAction = { label: '登記請假' };

  readonly page = input.required<RouteObj>();

  private readonly leaveService = inject(LeaveService);
  /** 分校跟頂欄走（#1138）：頁內分校下拉拿掉 */
  private readonly campusCtx = inject(CampusContextService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly systemClock = inject(SystemClockService);
  private readonly dialogService = inject(DialogService);
  private readonly studentsService = inject(StudentsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly records = signal<LeaveRequest[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = LIST_PAGE_SIZE;

  /** 預設「待處理」＝還沒結束的假（今天與之後）；「全部」才有篩選（A6） */
  protected readonly tab = signal<'pending' | 'all'>('pending');
  /** 兩個分頁的張數與色面句要的數字：各一支只取 `meta.total` 的查詢，不靠目前這一頁推算 */
  protected readonly pendingCount = signal<number | null>(null);
  protected readonly allCount = signal<number | null>(null);
  private readonly todayLeaves = signal<LeaveRequest[] | null>(null);

  protected filterDateRange: Date[] | null = null;
  protected readonly studentValue = signal<Student | string | null>(null);
  protected readonly studentSuggestions = signal<Student[]>([]);
  private readonly studentId = signal<string | null>(null);
  protected readonly hasFilter = signal(false);

  protected readonly studentRoute = RoutesCatalog.ADMIN_STUDENT_DETAIL.absolutePath;

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalRecords() / this.PAGE_SIZE)),
  );

  /** 色面句。今天幾位（不重複的學生）、之後還有幾筆（待處理總數扣掉今天進行中的） */
  protected readonly headline = computed(() => {
    const today = this.todayLeaves();
    const pending = this.pendingCount();
    if (today === null || pending === null) return null;
    const students = new Set(today.map((r) => r.studentId)).size;
    return `今天 ${students} 位請假，之後還有 ${Math.max(pending - today.length, 0)} 筆。`;
  });

  /**
   * 章：待處理依「今天／明天／之後的日期」，進行中的跨日假歸今天；全部依開始日。
   * 列表本來就是 API 依開始日排好的（`order`），這裡只切段，不重排。
   */
  protected readonly chapters = computed(() => {
    const today = this.systemClock.todayTaipei();
    const tomorrow = addDaysToDateString(today, 1);
    const pending = this.tab() === 'pending';
    const groups: { key: string; name: string; meta: string; rows: LeaveRequest[] }[] = [];

    for (const record of this.records()) {
      const key = pending && record.startDate < today ? today : record.startDate;
      let group = groups.find((g) => g.key === key);
      if (!group) {
        const name = key === today ? '今天' : key === tomorrow ? '明天' : monthDay(key);
        group = { key, name, meta: `${monthDay(key)}（${weekdayOf(key)}）`, rows: [] };
        groups.push(group);
      }
      group.rows.push(record);
    }
    return groups;
  });

  protected calcDays(startDate: string, endDate: string): number {
    return differenceInCalendarDays(new Date(endDate), new Date(startDate)) + 1;
  }

  /**
   * 台北日期，不是瀏覽器本地日期 —— **伺服器判斷「這張假還在不在進行中」用的是
   * 台北的今天**，基準不同的話畫面標「已過去」而後端仍當它進行中（或反過來），
   * 而使用者沒有任何線索知道兩邊不一致（#467 同族）。
   */
  protected leaveState(record: LeaveRequest): 'future' | 'active' | 'past' {
    const today = this.systemClock.todayTaipei();
    if (record.startDate > today) return 'future';
    if (record.endDate >= today) return 'active';
    return 'past';
  }

  protected submittedByRoleLabel(role: 'parent' | 'admin'): string {
    return role === 'parent' ? '家長' : '管理員';
  }

  /** 事後補請：建立日（台北）晚於假的開始日。不需要新欄位 —— `createdAt` 與 `startDate` 就夠 */
  protected isLate(record: LeaveRequest): boolean {
    return taipeiDateString(Date.parse(record.createdAt)) > record.startDate;
  }

  /** 「10/10 14:20」，建立時間用台北時區 */
  protected createdText(record: LeaveRequest): string {
    const at = new Date(record.createdAt);
    const day = taipeiDateString(at.getTime());
    const time = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
    return `${monthDay(day)} ${time}`;
  }

  /** 右欄：「建立者 · 10/10 14:20 建立」；家長自己送的加註「家長申請」（管理員代登記就是建立者本人，不重複） */
  protected byText(record: LeaveRequest): string {
    const who = record.submittedByName ?? this.submittedByRoleLabel(record.submittedByRole);
    const parts = [who, `${this.createdText(record)} 建立`];
    if (record.submittedByRole === 'parent') parts.push('家長申請');
    return parts.join(' · ');
  }

  /** 日期範圍的字：單日「10/10」，跨日「10/10–10/12」；有時間就接在後面 */
  protected rangeText(record: LeaveRequest): string {
    const start = `${monthDay(record.startDate)}${record.startTime ? ` ${record.startTime}` : ''}`;
    if (record.startDate === record.endDate && !record.endTime) return start;
    const end = `${record.startDate === record.endDate ? '' : monthDay(record.endDate)}${record.endTime ? `${record.startDate === record.endDate ? '' : ' '}${record.endTime}` : ''}`;
    return `${start}–${end}`;
  }

  constructor() {
    this.campusCtx.use();
    // 初次載入由 ngOnInit 做；這裡只管之後頂欄換分校
    toObservable(this.campusCtx.id)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.onFilterChange());
  }

  ngOnInit(): void {
    this.loadRecords();
    this.loadCounts();
  }

  protected loadRecords(): void {
    const today = this.systemClock.todayTaipei();
    const pending = this.tab() === 'pending';
    this.loading.set(true);
    this.leaveService
      .list({
        campusId: this.campusCtx.id() ?? undefined,
        // 待處理＝還沒結束、依開始日由早到晚；全部＝依開始日由新到舊，才有篩選
        ...(pending
          ? { endFrom: today, order: 'start_asc' as const }
          : {
              order: 'start_desc' as const,
              studentId: this.studentId() ?? undefined,
              dateFrom: this.filterDateRange?.[0]
                ? format(this.filterDateRange[0], 'yyyy-MM-dd')
                : undefined,
              dateTo: this.filterDateRange?.[1]
                ? format(this.filterDateRange[1], 'yyyy-MM-dd')
                : undefined,
            }),
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.records.set(res.data);
          this.totalRecords.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '錯誤',
            detail: '無法載入請假紀錄',
          });
          this.loading.set(false);
        },
      });
  }

  /** 兩個分頁的張數＋今天進行中的假。只取 `meta.total`／當天那批，各自失敗就留 `null` */
  private loadCounts(): void {
    const campusId = this.campusCtx.id() ?? undefined;
    const today = this.systemClock.todayTaipei();
    this.leaveService
      .list({ campusId, endFrom: today, pageSize: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.pendingCount.set(res.meta.total), error: () => undefined });
    this.leaveService
      .list({ campusId, pageSize: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.allCount.set(res.meta.total), error: () => undefined });
    this.leaveService
      .list({ campusId, coverDate: today, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.todayLeaves.set(res.data), error: () => undefined });
  }

  protected setTab(tab: 'pending' | 'all'): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.currentPage.set(1);
    this.loadRecords();
  }

  protected onStudentQuery(query: string): void {
    this.studentsService
      .list({ search: query, pageSize: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.studentSuggestions.set(res.data),
        error: () => this.studentSuggestions.set([]),
      });
  }

  /** 選到人（物件）才帶 studentId；打字中或清空就不篩 */
  protected onStudentChange(value: Student | string | null): void {
    this.studentValue.set(value);
    const id = value !== null && typeof value === 'object' ? value.id : null;
    if (id === this.studentId()) return;
    this.studentId.set(id);
    this.onFilterChange();
  }

  protected clearFilters(): void {
    this.studentValue.set(null);
    this.studentId.set(null);
    this.filterDateRange = null;
    this.onFilterChange();
  }

  protected onPageStep(delta: number): void {
    this.currentPage.update((page) => Math.min(Math.max(page + delta, 1), this.totalPages()));
    this.loadRecords();
  }

  protected onFilterChange(): void {
    this.hasFilter.set(this.studentId() !== null || (this.filterDateRange?.[0] ?? null) !== null);
    this.currentPage.set(1);
    this.loadRecords();
  }

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(LeaveFormDialogComponent, {
      header: '登記請假',
      width: '480px',
      modal: true,
    });

    if (!ref) return;

    ref.onClose.subscribe((leave: LeaveRequest | null) => {
      if (leave) {
        this.messageService.add({
          severity: 'success',
          summary: '已登記',
          detail: `${leave.studentName} 的請假已登記`,
        });
        this.currentPage.set(1);
        this.loadRecords();
        this.loadCounts();
      }
    });
  }

  protected openEditDialog(record: LeaveRequest): void {
    const ref = this.dialogService.open(LeaveFormDialogComponent, {
      header: '編輯請假',
      width: '480px',
      modal: true,
      data: { leave: record },
    });

    if (!ref) return;

    ref.onClose.subscribe((leave: LeaveRequest | null) => {
      if (leave) {
        this.messageService.add({
          severity: 'success',
          summary: '已更新',
          detail: `${leave.studentName} 的請假已更新`,
        });
        this.loadRecords();
        this.loadCounts();
      }
    });
  }

  protected openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: 'body',
      data: {
        resourceTypes: ['leave'],
      },
    });
  }

  protected confirmDelete(record: LeaveRequest): void {
    const state = this.leaveState(record);

    if (state === 'active') {
      this.confirmActiveDelete(record);
    } else if (state === 'past') {
      this.confirmPastDelete(record);
    } else {
      this.confirmFutureDelete(record);
    }
  }

  private confirmFutureDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      // 出缺席影響照 rules/attendance-rules.md §6–7：還沒開始的假沒有任何出缺席紀錄
      message:
        `確定要取消 ${record.studentName} 的請假（${record.startDate} ~ ${record.endDate}）？\n` +
        `這張假還沒開始，取消後不影響任何出缺席紀錄。`,
      header: '取消請假',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '確認取消',
      rejectLabel: '返回',
      accept: () =>
        this.executeDelete(record, 'full', '已取消請假', `${record.studentName} 的請假申請已取消`),
    });
  }

  private confirmPastDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      // 舊文案寫「同步恢復對應課堂的出勤狀態」—— 與 rules §6／API 不符：已點過名的日子不動
      message:
        `${record.studentName} 的請假（${record.startDate} ~ ${record.endDate}）已經結束。\n` +
        `取消後，還沒點名的日子，請假紀錄會被刪掉、回到「還沒點名」；已經點過名的日子不會動。\n` +
        `此操作無法復原。`,
      header: '取消歷史請假',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '確認刪除',
      rejectLabel: '返回',
      accept: () =>
        this.executeDelete(record, 'full', '已刪除', `${record.studentName} 的歷史請假紀錄已刪除`),
    });
  }

  private confirmActiveDelete(record: LeaveRequest): void {
    // **這兩個日期只出現在訊息裡，真正的截斷是後端 `truncate` 做的** ——
    // 所以它們是在**轉述後端做了什麼**，必須用後端的曆法。差一天的話，
    // 一個已經完成的破壞性操作會被告知一個錯的日期。
    // `yesterday` 走純字串加減（見 `addDaysToDateString` 檔頭），
    // 不用 `Date.now() - 86400000` —— 那是對一個瞬間做算術再用本地時區格式化。
    const today = this.systemClock.todayTaipei();
    const yesterday = addDaysToDateString(today, -1);

    this.confirmationService.confirm({
      message:
        `${record.studentName} 的假目前進行中（${record.startDate} ~ ${record.endDate}）。\n` +
        `・取消剩餘假期：保留到 ${yesterday}，今天起還沒點名的課回到「還沒點名」。\n` +
        `・完全刪除：整張假撤銷；還沒點名的日子都回到「還沒點名」，已經點過名的日子不會動。`,
      header: '取消進行中假期',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '取消剩餘假期',
      rejectLabel: '完全刪除',
      accept: () =>
        this.executeDelete(
          record,
          'truncate',
          '已取消剩餘假期',
          `已保留至 ${yesterday} 的請假，${today} 起恢復出勤`,
        ),
      reject: (type?: ConfirmEventType) => {
        if (type === ConfirmEventType.REJECT) {
          setTimeout(() => this.confirmFullActiveDelete(record));
        }
      },
    });
  }

  private confirmFullActiveDelete(record: LeaveRequest): void {
    this.confirmationService.confirm({
      message:
        `確定要完全刪除 ${record.studentName} 的請假紀錄（${record.startDate} ~ ${record.endDate}）？\n` +
        `整張假都會撤銷：還沒點名的日子（含已過去的）回到「還沒點名」，已經點過名的日子不會動。\n` +
        `此操作無法復原。`,
      header: '完全刪除請假紀錄',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '確認完全刪除',
      rejectLabel: '返回',
      accept: () =>
        this.executeDelete(
          record,
          'full',
          '已刪除請假紀錄',
          `${record.studentName} 的請假紀錄已完全刪除`,
        ),
    });
  }

  private executeDelete(
    record: LeaveRequest,
    mode: 'truncate' | 'full',
    summary: string,
    detail: string,
  ): void {
    this.leaveService.delete(record.id, mode).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary, detail });
        this.loadRecords();
        this.loadCounts();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '操作失敗，請稍後再試',
        });
      },
    });
  }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** `2026-10-10` → `10/10` */
function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 台北日期字串的星期（用正午避開時區邊界） */
function weekdayOf(date: string): string {
  return `週${WEEKDAYS[new Date(`${date}T12:00:00+08:00`).getUTCDay()]}`;
}
