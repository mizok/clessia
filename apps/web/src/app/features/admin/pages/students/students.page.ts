import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, debounceTime, filter, switchMap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { AuthService } from '@core/auth.service';
import { OrgSettingsService } from '@core/org-settings.service';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';

// Services
import {
  StudentsService,
  Student,
  StudentListResponse,
  GradeLevel,
  StudentTodayFilter,
  StudentTodayState,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { RouteObj, RoutesCatalog } from '@core/smart-enums/routes-catalog';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';

// Local
import { StudentFormDialogComponent } from './student-form-dialog.component';
import { printCheckinCards } from './checkin-cards';
import { LIST_PAGE_SIZE } from '@shared/utils/list-page-size';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { FilterToggleComponent } from '@shared/components/filter-toggle/filter-toggle.component';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';

type StudentStatusFilter = 'active' | 'inactive' | 'all';

const TAIPEI_TIME = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const STATUS_TO_IS_ACTIVE: Record<StudentStatusFilter, boolean | undefined> = {
  active: true,
  inactive: false,
  all: undefined,
};

const taipeiTime = (iso: string): string => TAIPEI_TIME.format(new Date(iso));

@Component({
  selector: 'app-students',
  standalone: true,
  imports: [
    PageActionsComponent,
    PageOpenComponent,
    ChapterHeadComponent,
    FilterToggleComponent,
    RouterLink,
    PaginatorModule,
    CommonModule,
    FormsModule,
    ButtonModule,
    ToastModule,
    TooltipModule,
    SkeletonModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    EmptyStateComponent,
    LoadFailedComponent,
    PopupMenuComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './students.page.html',
})
export class StudentsPage implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly studentsService = inject(StudentsService);

  /** 搜尋輸入 —— 節流 + 去重之後才進 `loadStudents()`（#659） */
  private readonly searchInput = new Subject<string>();
  /**
   * **所有**取數都經過這裡，然後 `switchMap` 出去。
   *
   * `debounce` 只解一半：打字慢的人（每次間隔超過 300ms）仍然會送出多支請求，
   * 而它們回來的順序不保證 —— **先發的後到就會蓋掉畫面**，而畫面上的輸入框
   * 顯示的是最新的字。使用者看到「陳小華」配「陳」的結果，
   * 而且**它不會自己追上**（沒有任何後續事件會重查）。
   *
   * 讓每一個取數都走同一條 `switchMap`，新的一發就取消舊的那一支。
   */
  private readonly loadRequests = new Subject<void>();
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly orgSettings = inject(OrgSettingsService);

  /** 到班卡（#1127 B）：發卡是學生管理的事，跟編輯學生同一個門檻 */
  protected readonly canPrintCards = this.auth.hasPermission('manage_students');

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  readonly page = input.required<RouteObj>();
  // State
  readonly students = signal<Student[]>([]);
  readonly loading = signal(true);

  /**
   * 取數失敗。**跟 `students().length === 0` 是兩件事** —— `catchError` 回 `EMPTY`
   * 之後兩者在狀態上相同，而畫面只看狀態，於是失敗會被渲染成「尚未有學生資料」（#788）。
   */
  readonly loadFailed = signal(false);
  readonly searchQuery = signal('');
  readonly selectedGrade = signal<GradeLevel | null>(null);
  readonly summary = signal<StudentListResponse['summary']>({
    total: 0,
    activeCount: 0,
    byGrade: [],
  });
  protected readonly currentPage = signal(1);
  protected readonly total = signal(0);
  /** 預設只列在籍（A6 名冊沒有「停用」；要看停用的人在篩選面板第三列，#1314 SL 裁定） */
  protected readonly statusFilter = signal<StudentStatusFilter>('active');
  protected readonly todayFilter = signal<StudentTodayFilter | null>(null);
  protected readonly PAGE_SIZE = LIST_PAGE_SIZE;

  /**
   * 今日到班各狀態人數。後端只有第一頁（或帶 `today` 時）才算，翻到第 2 頁會回 null ——
   * 留著上一次算到的，篩選面板與標題才不會翻頁就掉數字。
   */
  protected readonly todayCounts = signal<Record<StudentTodayFilter, number> | null>(null);
  /**
   * 這個分校是不是逐堂點名（後端回 `today: null` 且是第一頁）。是的話「今天」那列整排灰掉並說明，
   * 不讓使用者按下去吃 400（`TODAY_UNSUPPORTED_MODE`）。
   */
  protected readonly todayUnsupported = signal(false);

  protected readonly todayOptions: { value: StudentTodayFilter | null; label: string }[] = [
    { value: null, label: '全部' },
    { value: 'any', label: '今天有課' },
    { value: 'arrived', label: '已到' },
    { value: 'not_yet', label: '還沒到' },
    { value: 'missing', label: '該到沒到' },
    { value: 'on_leave', label: '請假' },
  ];

  protected readonly statusOptions: { value: StudentStatusFilter; label: string }[] = [
    { value: 'active', label: '在籍' },
    { value: 'inactive', label: '已停用' },
    { value: 'all', label: '全部' },
  ];

  protected readonly gradeLabels = GRADE_LEVEL_LABELS;

  // Computed
  readonly activeStudentCount = computed(() => this.summary().activeCount);

  /** 頁尾分頁器的起點（`p-paginator` 用「第幾筆」不是「第幾頁」） */
  protected readonly pageFirst = computed(() =>
    Math.max((this.currentPage() - 1) * this.PAGE_SIZE, 0),
  );

  /** 手機的「篩選：全部」面板開合與摘要；桌機也渲染（A6 的篩選鈕） */
  protected readonly filtersOpen = signal(false);
  protected readonly filterSummary = computed(() => {
    const grade = this.selectedGrade();
    const today = this.todayFilter();
    const status = this.statusFilter();
    const parts = [
      grade ? GRADE_LEVEL_LABELS[grade] : '',
      today ? this.todayOptions.find((o) => o.value === today)!.label : '',
      status === 'active' ? '' : status === 'inactive' ? '已停用' : '含停用',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '全部';
  });
  protected readonly hasFilter = computed(
    () =>
      this.selectedGrade() !== null ||
      this.todayFilter() !== null ||
      this.statusFilter() !== 'active',
  );
  /** 搜尋或任何篩選生效：色面標題改「符合篩選的 N 位」，名冊上方出現「顯示 N 位 · 清除篩選」 */
  protected readonly narrowed = computed(() => this.searchQuery() !== '' || this.hasFilter());

  /** 年級列各鈕的人數。「全部」＝各章加總（byGrade 不吃 grade，所以選了年級也對） */
  protected readonly gradeOptions = computed(() => {
    const byGrade = this.summary().byGrade;
    return [
      {
        value: null as GradeLevel | null,
        label: '全部',
        count: byGrade.reduce((n, g) => n + g.count, 0),
      },
      ...byGrade
        .filter((g) => g.count > 0 || g.grade === this.selectedGrade())
        .map((g) => ({
          value: g.grade as GradeLevel | null,
          label: GRADE_LEVEL_LABELS[g.grade],
          count: g.count,
        })),
    ];
  });

  /**
   * 這一頁的列依年級切成章。列表由後端先依年級再依姓名排（#1314 SL），同年級一定相鄰；
   * 翻頁時章可能在頁首接續，章名照寫（同 parents／courses）。
   */
  protected readonly chapters = computed(() => {
    const result: { grade: GradeLevel; rows: Student[] }[] = [];
    for (const student of this.students()) {
      const last = result.at(-1);
      if (last && last.grade === student.grade) last.rows.push(student);
      else result.push({ grade: student.grade, rows: [student] });
    }
    return result;
  });

  /** 章名旁的人數：`byGrade` 吃搜尋與其他篩選、不吃年級，所以搜尋中也對得上底下的列 */
  protected chapterTally(grade: GradeLevel): number | null {
    return this.summary().byGrade.find((g) => g.grade === grade)?.count ?? null;
  }

  /** 名字右邊只用字（A6）：到班時間、還沒到、該到沒到（紅）、請假；今天沒課的人是 null */
  protected todayMeta(student: Student): { text: string; missing: boolean } | null {
    const status = student.todayStatus;
    if (!status) return null;
    const text: Record<StudentTodayState, string> = {
      arrived: status.arrivedAt ? `${taipeiTime(status.arrivedAt)} 到` : '已到',
      not_yet: '還沒到',
      missing: '該到沒到',
      on_leave: '請假',
    };
    return { text: text[status.state], missing: status.state === 'missing' };
  }

  protected readonly flagLabels = {
    pending_payment: '待繳費',
    suspended: '暫停',
    withdrawal: '退班',
  } as const;

  /** 暫停／退班／停用的人整格淡化（A6 `who--quiet`） */
  protected isQuiet(student: Student): boolean {
    return (
      !student.isActive ||
      student.enrollmentState === 'suspended' ||
      student.enrollmentState === 'withdrawal'
    );
  }

  /**
   * 頁面層級的「⋯」（A6 沒畫、現況有的收進這裡，計畫席 10-10 裁定）：列印本頁到班卡。
   * 邏輯照舊（`printCards`），只是入口從工具列的一顆鈕搬進選單。
   */
  protected readonly pageMenuItems = computed<MenuItem[]>(() =>
    this.canPrintCards && this.students().length > 0
      ? [
          {
            label: '列印本頁到班卡',
            icon: 'pi pi-qrcode',
            command: () => this.printCards(this.students()),
          },
        ]
      : [],
  );

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedStudent = signal<Student | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const student = this.selectedStudent();
    if (!student) return [];
    return [
      {
        label: '學生詳情',
        icon: 'pi pi-arrow-right',
        command: () => this.navigateToDetail(student),
      },
      { separator: true },
      { label: '編輯', icon: 'pi pi-pencil', command: () => this.openEditDialog(student) },
      ...(this.canPrintCards
        ? [
            {
              label: '列印到班卡',
              icon: 'pi pi-qrcode',
              command: () => this.printCards([student]),
            },
          ]
        : []),
      ...(student.isActive
        ? [
            { separator: true },
            { label: '停用', icon: 'pi pi-lock', command: () => this.confirmDeactivate(student) },
          ]
        : []),
      { separator: true },
      {
        label: student.hasEnrollments ? '已有報名紀錄，無法刪除' : '刪除學生',
        icon: 'pi pi-trash',
        disabled: student.hasEnrollments,
        styleClass: student.hasEnrollments ? '' : 'text-red-500',
        command: () => this.confirmDelete(student),
      },
    ];
  });

  protected openActionMenu(event: MouseEvent, student: Student): void {
    this.selectedStudent.set(student);
    this.actionMenu().toggle(event);
  }

  ngOnInit(): void {
    // 到班卡上要印補習班名；視窗得在點擊當下開，不能等這裡（見 printCards）
    if (this.canPrintCards && this.orgSettings.status() === 'unloaded') this.orgSettings.load();
    this.setupLoadPipeline();

    // 搜尋：節流 + 去重，然後才觸發取數。
    // `distinctUntilChanged` 擋的是「同一個字重複送」——例如中文輸入法組字過程中
    // 送出同樣的中間值，或使用者貼上同樣的內容。
    this.searchInput
      // 去重對照**目前生效的查詢**而不是上一次輸入：「清除篩選」會直接把 `searchQuery` 清掉，
      // 之後再打同一個字要送得出去（`distinctUntilChanged` 記的是上一次輸入，清除不會更新它）
      .pipe(
        debounceTime(300),
        filter((value) => value !== this.searchQuery()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.loadStudents();
      });

    this.loadStudents();
  }

  /** 觸發取數。實際的請求在 `ngOnInit` 的那條 `switchMap` 管線裡（#659） */
  loadStudents(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.loadRequests
      .pipe(
        switchMap(() =>
          this.studentsService
            .list({
              search: this.searchQuery() || undefined,
              grade: this.selectedGrade() ?? undefined,
              page: this.currentPage(),
              pageSize: this.PAGE_SIZE,
              isActive: STATUS_TO_IS_ACTIVE[this.statusFilter()],
              today: this.todayFilter() ?? undefined,
            })
            // **`catchError` 必須在內層，不能掛在外層 `pipe` 上。**
            // 所有取數收進單一管線之後，內層的 error 會終止外層 ——
            // **一次網路錯誤就讓這一頁再也載入不了任何東西**，而畫面上只有一則
            // toast，看起來像「這次失敗了」不是「這一頁壞了」。
            // 由 spec 的「一次請求失敗之後…」那條釘住（#689）。
            .pipe(
              catchError((err) => {
                // 逐堂點名的分校不支援「今天」篩選：退回不篩、重查，不讓整頁變成載入失敗
                if (err?.error?.code === 'TODAY_UNSUPPORTED_MODE') {
                  this.todayUnsupported.set(true);
                  this.todayFilter.set(null);
                  this.loadStudents();
                  return EMPTY;
                }
                console.error('Failed to load students', err);
                // **不再發 toast** —— 主體現在有常駐的失敗狀態（照 /admin/payments 的正例）。
                // 一則會消失的 toast 加上一個留著的錯誤畫面，兩個訊號互相矛盾（#788）。
                this.loadFailed.set(true);
                this.loading.set(false);
                // `EMPTY` 照舊 —— 它是 #689 的修法，拆掉會讓整條管線死在第一次錯誤上。
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res: StudentListResponse) => {
        this.students.set(res.data);
        this.total.set(res.meta.total);
        this.summary.set(res.summary);
        if (res.summary.today) this.todayCounts.set(res.summary.today);
        // 只有第一頁才分得出「沒算」與「這個分校不支援」；翻頁（today 回 null）不改判
        if (res.meta.page === 1) this.todayUnsupported.set(!res.summary.today);
        this.loading.set(false);
      });
  }

  protected onSearchChange(value: string): void {
    this.searchInput.next(value);
  }

  protected onGradeChange(grade: GradeLevel | null): void {
    this.selectedGrade.set(grade);
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onTodayChange(value: StudentTodayFilter | null): void {
    if (this.todayUnsupported()) return;
    this.todayFilter.set(value);
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onStatusFilterChange(value: StudentStatusFilter): void {
    this.statusFilter.set(value);
    this.currentPage.set(1);
    this.loadStudents();
  }

  /** 搜尋與所有篩選一起清（只清篩選、搜尋還在，使用者會以為沒清乾淨） */
  protected clearFilters(): void {
    this.searchQuery.set('');
    this.selectedGrade.set(null);
    this.todayFilter.set(null);
    this.statusFilter.set('active');
    this.currentPage.set(1);
    this.loadStudents();
  }

  protected onPage(event: PaginatorState): void {
    this.currentPage.set((event.page ?? 0) + 1);
    this.loadStudents();
  }

  protected navigateToDetail(student: Student): void {
    this.router.navigate([RoutesCatalog.ADMIN_STUDENTS.absolutePath, student.id]);
  }

  protected readonly primaryAction: PageAction = { label: '新增學生', icon: 'pi pi-plus' };

  /**
   * 印到班卡（#1127 B）。「本頁」＝目前篩選與分頁下畫面上這些人 —— 開學一次發一個班的做法是
   * 篩年級、把每頁筆數拉大再印，不另做勾選。
   * **視窗在點擊同一個 tick 開**（`printCheckinCards` 先開再等 QR），補習班名要先載好，所以 ngOnInit 預載設定。
   */
  protected printCards(students: readonly Student[]): void {
    void printCheckinCards(
      students.map((s) => ({ studentId: s.id, name: s.name })),
      this.orgSettings.settings()?.name ?? '',
    ).then((opened) => {
      if (!opened) {
        this.messageService.add({
          severity: 'warn',
          summary: '無法開啟列印視窗',
          detail: '瀏覽器擋掉了彈出視窗，請允許本站的彈出視窗後再試',
        });
      }
    });
  }

  openEditDialog(student: Student): void {
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student },
    });

    if (ref) {
      ref.onClose.subscribe((updatedStudent) => {
        if (updatedStudent) this.loadStudents();
      });
    }
  }

  /**
   * `StudentFormDialogComponent` 早就有建立模式（`isCreateMode()`），但這一頁
   * 從來沒有入口叫得到它——`kb/wiki/specs/admin/student-affairs/students.md`
   * 明寫「待實作：手動新增學生功能尚未完成」。這支只是接線，不是新設計。
   */
  openCreateDialog(): void {
    const ref = this.dialogService.open(StudentFormDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { student: null },
    });

    if (!ref) return;
    ref.onClose.subscribe((createdStudent) => {
      if (!createdStudent) return;
      this.messageService.add({
        severity: 'success',
        summary: '已建立',
        detail: `「${createdStudent.name}」已建立`,
      });
      this.loadStudents();
    });
  }

  confirmDeactivate(student: Student): void {
    this.openConfirmDialog(
      '確認停用',
      {
        message: `確定要停用「${student.name}」嗎？停用後該學生將不會出現在預設篩選結果中。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => this.deactivateStudent(student),
    );
  }

  confirmDelete(student: Student): void {
    if (student.hasEnrollments) return;
    this.openConfirmDialog(
      '確認刪除',
      {
        message: `確定要刪除「${student.name}」嗎？此操作無法復原。`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.deleteStudent(student),
    );
  }

  private deleteStudent(student: Student): void {
    this.studentsService.delete(student.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已刪除',
          detail: `「${student.name}」已刪除`,
        });
        this.loadStudents();
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '刪除失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  /**
   * **停用是軟的（#876）。** 這裡原本逐字呼叫 `this.studentsService.delete(...)` ——
   * 跟 `deleteStudent()` 同一支 API，兩者只有 toast 文字不同，於是按「停用」會把學生
   * 從 DB 永久刪掉，而確認文案寫的是「不會出現在預設篩選結果中」。
   *
   * **那個 bug 藏得住是因為 toast 文字從頭到尾都是對的** —— 畫面說「已停用」。
   * 所以 spec 釘的是「呼叫了哪一支 API」，不是 toast 文字。
   */
  private deactivateStudent(student: Student): void {
    this.studentsService.update(student.id, { isActive: false }).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '已停用',
          detail: `「${student.name}」已停用`,
        });
        this.loadStudents();
      },
      error: (err) => {
        console.error('Failed to deactivate student', err);
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private openConfirmDialog(header: string, data: ConfirmDialogData, onAccept: () => void): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    if (!ref) return;
    ref.onClose.subscribe((result) => {
      if (result) onAccept();
    });
  }
}
