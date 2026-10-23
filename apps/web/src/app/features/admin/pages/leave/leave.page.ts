import { AuditLogButtonComponent } from '@shared/components/audit-log-button/audit-log-button.component';
import { OverlayContainerService } from '@core/overlay-container.service';
import { Component, DestroyRef, OnInit, inject, signal, computed, input } from '@angular/core';
import { ReloadVeilComponent } from '@shared/components/reload-veil/reload-veil.component';
import { FormsModule } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
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
import { LeaveBatchDialogComponent } from './leave-batch-dialog/leave-batch-dialog.component';
import { CampusScopeNoteComponent } from '@shared/components/campus-scope-note/campus-scope-note.component';
import {
  SystemClockService,
  addDaysToDateString,
  taipeiDateString,
} from '@core/system-clock.service';
import { StudentsService, type Student } from '@core/students.service';
import { CoursesService, type Course } from '@core/courses.service';
import { ClassesService, type Class } from '@core/classes.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import {
  LEAVE_DIALOG_CONTENT_STYLE,
  LeaveFormDialogComponent,
} from '@shared/components/leave-form-dialog/leave-form-dialog.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { StudentAutocompleteComponent } from '@shared/components/student-autocomplete/student-autocomplete.component';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';
import { injectOptimisticRemove } from '@shared/utils/optimistic-remove.util';
import { injectViewTransition } from '@shared/utils/view-transition.util';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-leave',
  standalone: true,
  imports: [
    AuditLogButtonComponent,
    SkeletonComponent,
    ReloadVeilComponent,
    CampusScopeNoteComponent,
    PageOpenComponent,
    PageActionsComponent,
    ChapterHeadComponent,
    StudentAutocompleteComponent,
    RouterLink,
    FormsModule,
    DatePickerModule,
    SelectModule,
    TooltipModule,
    ConfirmDialogModule,
    DynamicDialogModule,
  ],
  providers: [ConfirmationService, DialogService],
  templateUrl: './leave.page.html',
})
export class LeavePage implements OnInit {
  /** 主要行動。**寫成 readonly property 不是模板裡的物件字面量** ——
   *  字面量每輪變更偵測都會產生新物件，讓 signal input 每次都判定為「變了」。 */
  protected readonly primaryAction: PageAction = { label: '登記請假', icon: 'pi pi-plus' };

  readonly page = input.required<RouteObj>();

  private readonly leaveService = inject(LeaveService);
  /** 分校跟頂欄走（#1138）：頁內分校下拉拿掉 */
  private readonly campusCtx = inject(CampusContextService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly systemClock = inject(SystemClockService);
  private readonly dialogService = inject(DialogService);
  // 彈窗掛在殼層的 overlay 容器：#166 的 max-height（--shell-layout-body-height）才吃得到，
  // 長表單才會在彈窗裡捲、動作列才黏得住（掛 body 時整個彈窗超出視窗，#1768 量到）
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly studentsService = inject(StudentsService);
  private readonly coursesService = inject(CoursesService);
  private readonly classesService = inject(ClassesService);
  private readonly destroyRef = inject(DestroyRef);
  /** 頁內模式切換的同文件 VT（#1641 項 4） */
  private readonly viewTransition = injectViewTransition();
  private readonly optimisticRemove = injectOptimisticRemove();

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
  /** 課程／開課班（#1100 #31，A6 `.ff` 的另外兩欄）：選了課程，開課班只列那門課的班 */
  protected readonly courseId = signal<string | null>(null);
  protected readonly classId = signal<string | null>(null);
  private readonly courses = signal<Course[]>([]);
  private readonly classes = signal<Class[]>([]);
  protected readonly courseOptions = computed(() => [
    { label: '全部課程', value: null },
    ...this.courses().map((c) => ({ label: c.name, value: c.id })),
  ]);
  protected readonly classOptions = computed(() => [
    { label: '全部開課班', value: null },
    ...this.classes().map((c) => ({ label: c.name, value: c.id })),
  ]);
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
    // 兩行（A6）：逗號後換行，由模板用 <br />
    return {
      today: `今天 ${students} 位請假，`,
      later: `之後還有 ${Math.max(pending - today.length, 0)} 筆。`,
    };
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
        // A6 章名下小字：今天／明天寫「10/1（四）」（名字不含日期），一般日期名字就是日期，只寫「週二」
        const meta =
          key === today || key === tomorrow
            ? `${monthDay(key)}（${weekdayOf(key).slice(1)}）`
            : weekdayOf(key);
        group = { key, name, meta, rows: [] };
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
      .subscribe(() => {
        // 換分校：開課班清單跟著換，已選的班可能不在新分校 —— 清掉
        this.classId.set(null);
        this.loadClasses();
        this.onFilterChange();
      });
  }

  ngOnInit(): void {
    this.loadFilterOptions();
    this.loadRecords();
    this.loadCounts();
  }

  /**
   * `quiet`：刪除或截斷成功後的背景重抓 —— 畫面已經是結果了，不再變淡（#1641 5b 第 1 點）。
   * `rows`：登記／編輯／刪除造成的重抓，回應套上時那一列淡入、淡出或就地更新（換條件不帶）。
   */
  protected loadRecords({
    quiet = false,
    rows = false,
  }: { quiet?: boolean; rows?: boolean } = {}): void {
    const today = this.systemClock.todayTaipei();
    const pending = this.tab() === 'pending';
    if (!quiet) this.loading.set(true);
    this.leaveService
      .list({
        campusId: this.campusCtx.id() ?? undefined,
        // 待處理＝還沒結束、依開始日由早到晚；全部＝依開始日由新到舊，才有篩選
        ...(pending
          ? { endFrom: today, order: 'start_asc' as const }
          : {
              order: 'start_desc' as const,
              studentId: this.studentId() ?? undefined,
              courseId: this.courseId() ?? undefined,
              classId: this.classId() ?? undefined,
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
          // 舊內容（變淡中）平滑換成新資料（#1641 5b）
          this.viewTransition(
            () => {
              this.records.set(res.data);
              this.totalRecords.set(res.meta.total);
              this.loading.set(false);
            },
            { rows },
          );
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
    this.viewTransition(() => {
      this.tab.set(tab);
      this.currentPage.set(1);
      this.loadRecords();
    });
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

  /** 篩選用的選項；失敗就只是少一個下拉，不擋列表（同營收報表） */
  private loadFilterOptions(): void {
    this.coursesService.list({ isActive: true, pageSize: 200 }).subscribe({
      next: (res) => this.courses.set(res.data),
      error: () => this.courses.set([]),
    });
    this.loadClasses();
  }

  private loadClasses(): void {
    this.classesService
      .list({
        isActive: true,
        pageSize: 0,
        campusId: this.campusCtx.id() ?? undefined,
        courseId: this.courseId() ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.classes.set(res.data),
        error: () => this.classes.set([]),
      });
  }

  protected onCourseChange(value: string | null): void {
    this.courseId.set(value);
    // 換課程：開課班只列這門課的，已選的班不一定屬於它 —— 清掉
    this.classId.set(null);
    this.loadClasses();
    this.onFilterChange();
  }

  protected onClassChange(value: string | null): void {
    this.classId.set(value);
    this.onFilterChange();
  }

  protected clearFilters(): void {
    this.studentValue.set(null);
    this.studentId.set(null);
    if (this.courseId() !== null) {
      this.courseId.set(null);
      this.loadClasses();
    }
    this.classId.set(null);
    this.filterDateRange = null;
    this.onFilterChange();
  }

  protected onPageStep(delta: number): void {
    this.currentPage.update((page) => Math.min(Math.max(page + delta, 1), this.totalPages()));
    this.loadRecords();
  }

  protected onFilterChange(): void {
    this.hasFilter.set(
      this.studentId() !== null ||
        this.courseId() !== null ||
        this.classId() !== null ||
        (this.filterDateRange?.[0] ?? null) !== null,
    );
    this.currentPage.set(1);
    this.loadRecords();
  }

  protected openCreateDialog(): void {
    const ref = this.dialogService.open(LeaveFormDialogComponent, {
      header: '登記請假',
      width: '480px',
      modal: true,
      appendTo: this.overlayContainerService.getContainer() || 'body',
      contentStyle: LEAVE_DIALOG_CONTENT_STYLE,
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
        this.loadRecords({ rows: true });
        this.loadCounts();
      }
    });
  }

  /** 批次請假（#1100 #32，A6）：建了幾張就重抓；沒成功的那幾位留在窗裡處理 */
  protected openBatchDialog(): void {
    const ref = this.dialogService.open(LeaveBatchDialogComponent, {
      header: '批次請假',
      width: '560px',
      modal: true,
      appendTo: this.overlayContainerService.getContainer() || 'body',
      data: { campusId: this.campusCtx.id() },
    });
    ref?.onClose.subscribe((result: { created: number } | null) => {
      if (!result?.created) return;
      this.messageService.add({
        severity: 'success',
        summary: '已登記',
        detail: `已幫 ${result.created} 位學生請假`,
      });
      this.currentPage.set(1);
      this.loadRecords({ rows: true });
      this.loadCounts();
    });
  }

  protected openEditDialog(record: LeaveRequest): void {
    const ref = this.dialogService.open(LeaveFormDialogComponent, {
      header: '編輯請假',
      width: '480px',
      modal: true,
      appendTo: this.overlayContainerService.getContainer() || 'body',
      contentStyle: LEAVE_DIALOG_CONTENT_STYLE,
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
        this.loadRecords({ rows: true });
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

  /**
   * 先問後端這次會動到幾堂（#1100 #33），把數字接在確認文案後面再開窗。
   * 讀不到就照原本的文案開 —— 預覽是加分，不能擋住取消
   */
  private withImpact(
    record: LeaveRequest,
    mode: 'truncate' | 'full',
    open: (line: string) => void,
  ): void {
    this.leaveService
      .impact(record.id, mode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => open(`\n${impactLine(data)}`),
        error: () => open(''),
      });
  }

  private confirmPastDelete(record: LeaveRequest): void {
    this.withImpact(record, 'full', (line) => this.openPastDelete(record, line));
  }

  private openPastDelete(record: LeaveRequest, impact: string): void {
    this.confirmationService.confirm({
      // 舊文案寫「同步恢復對應課堂的出勤狀態」—— 與 rules §6／API 不符：已點過名的日子不動
      message:
        `${record.studentName} 的請假（${record.startDate} ~ ${record.endDate}）已經結束。\n` +
        `取消後，還沒點名的日子，請假紀錄會被刪掉、回到「還沒點名」；已經點過名的日子不會動。` +
        `${impact}\n` +
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
    this.withImpact(record, 'truncate', (line) => this.openActiveDelete(record, line));
  }

  private openActiveDelete(record: LeaveRequest, impact: string): void {
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
        `・完全刪除：整張假撤銷；還沒點名的日子都回到「還沒點名」，已經點過名的日子不會動。` +
        // 這一窗的數字是「取消剩餘假期」的；完全刪除的數字在下一窗
        (impact ? `\n取消剩餘假期${impact.trim().replace('實際會動到', '')}` : ''),
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
    this.withImpact(record, 'full', (line) => this.openFullActiveDelete(record, line));
  }

  private openFullActiveDelete(record: LeaveRequest, impact: string): void {
    this.confirmationService.confirm({
      message:
        `確定要完全刪除 ${record.studentName} 的請假紀錄（${record.startDate} ~ ${record.endDate}）？\n` +
        `整張假都會撤銷：還沒點名的日子（含已過去的）回到「還沒點名」，已經點過名的日子不會動。` +
        `${impact}\n` +
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

  /**
   * `full`（取消或刪除整筆）是樂觀的：按下就淡出，失敗放回並說明（#1641 5b 第 1 點）。
   * `truncate`（進行中的假提早結束）**那一列不會消失**，只是結束日改了 —— 沒有東西可以先拿掉，
   * 所以等伺服器回來，由重抓就地換上新的結束日。
   */
  private executeDelete(
    record: LeaveRequest,
    mode: 'truncate' | 'full',
    summary: string,
    detail: string,
  ): void {
    const request = this.leaveService.delete(record.id, mode);
    const handlers = {
      next: () => {
        this.messageService.add({ severity: 'success', summary, detail });
        this.loadRecords({ quiet: true, rows: true });
        this.loadCounts();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: '錯誤',
          detail: '操作失敗，請稍後再試',
        });
      },
    };
    if (mode === 'full') {
      this.optimisticRemove(this.records, (r) => r.id === record.id, request, handlers);
    } else {
      request.subscribe(handlers);
    }
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

/** 預覽的那一句（#1100 #33）。0／0 也要說 —— 「沒有任何紀錄會動」本身就是使用者要的答案 */
export function impactLine(i: { revertCount: number; keptCount: number }): string {
  if (i.revertCount === 0 && i.keptCount === 0) return '目前沒有任何出缺席紀錄會被改動。';
  const parts = [];
  if (i.revertCount > 0) parts.push(`${i.revertCount} 堂會回到「還沒點名」`);
  if (i.keptCount > 0) parts.push(`${i.keptCount} 堂已點名，維持請假`);
  return `實際會動到：${parts.join('、')}。`;
}
