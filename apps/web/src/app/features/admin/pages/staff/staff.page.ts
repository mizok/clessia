import { Component, DestroyRef, OnInit, inject, signal, computed, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
// `Subject` 這個名字被 `@core/subjects.service` 的科目型別佔走了，所以 rxjs 的取別名。
import { EMPTY, Subject as RxSubject, catchError, debounceTime, skip, switchMap } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { StaffFormDialogComponent } from './staff-form-dialog.component';
import {
  KioskFormDialogComponent,
  type KioskFormDialogResult,
} from './kiosk-form-dialog/kiosk-form-dialog.component';
import { TeachingLogDialogComponent } from './teaching-log-dialog/teaching-log-dialog.component';
import { PermissionListDialogComponent } from './permission-list-dialog/permission-list-dialog.component';

// Services
import {
  StaffService,
  Staff,
  StaffListResponse,
  StaffRole,
  StaffStatus,
} from '@core/staff.service';
import { CampusesService, Campus } from '@core/campuses.service';
import { CampusContextService } from '@core/campus-context.service';
import { SubjectsService, Subject } from '@core/subjects.service';

// Shared
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { LoginLinkDialogComponent } from '@shared/components/login-link-dialog/login-link-dialog.component';
import { AuditLogDialogComponent } from '@shared/components/audit-log-dialog/audit-log-dialog.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import { OverlayContainerService } from '@core/overlay-container.service';
import { ReferenceDataService } from '@core/reference-data.service';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { ChapterHeadComponent } from '@shared/components/chapter-head/chapter-head.component';
import { FilterToggleComponent } from '@shared/components/filter-toggle/filter-toggle.component';
import { loginLinkErrorDetail } from '@shared/utils/login-link-error.util';
import {
  PageActionsComponent,
  type PageAction,
} from '@shared/components/page-actions/page-actions.component';

interface RoleOption {
  value: StaffRole;
  label: string;
}

interface StaffSummary {
  total: number;
  adminCount: number;
  teacherCount: number;
  multiRoleCount: number;
  activeCount: number;
  inactiveCount: number;
  archivedCount: number;
  byRole: { admin: number; teacher: number; kiosk: number; inactiveOrArchived: number };
}

type StaffChapterKey = 'admin' | 'teacher' | 'kiosk' | 'inactive';

interface StaffChapter {
  key: StaffChapterKey;
  label: string;
  count: number;
  rows: Staff[];
}

const ROLE_OPTIONS: RoleOption[] = [
  { value: 'admin', label: '管理員' },
  { value: 'teacher', label: '老師' },
  { value: 'kiosk', label: '掃碼機台' },
];

/**
 * 狀態篩選。A6 預設「啟用中＋已停用」（不含封存）：API 的 `status` 是單一值、沒有「不含封存」，
 * 所以 `live` 與 `all` 都不帶 status 取全部，`live` 在前端濾掉封存的列（章名張數見 `chapters`）。
 */
type StaffStatusFilter = StaffStatus | 'live' | 'all';

const STATUS_OPTIONS: { value: StaffStatusFilter; label: string }[] = [
  { value: 'live', label: '啟用中＋已停用' },
  { value: 'active', label: '啟用中' },
  { value: 'inactive', label: '已停用' },
  { value: 'archived', label: '已封存' },
  { value: 'all', label: '全部（含已封存）' },
];

const STATUS_TEXT: Record<StaffStatus, string> = {
  active: '啟用中',
  inactive: '已停用',
  archived: '已封存',
};

/** 分校門口的打卡平板（#1127）。只能單獨存在，所以看有沒有這個角色就夠 */
const isKiosk = (staff: Staff) => staff.roles.includes('kiosk');

@Component({
  selector: 'app-staff',
  standalone: true,
  imports: [
    PageActionsComponent,
    PageOpenComponent,
    ChapterHeadComponent,
    FilterToggleComponent,
    CommonModule,
    FormsModule,
    ButtonModule,
    ToastModule,
    TooltipModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    EmptyStateComponent,
    LoadFailedComponent,
    PopupMenuComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './staff.page.html',
})
export class StaffPage implements OnInit {
  /** 這一頁的主要行動。**寫成 readonly property 不是模板裡的物件字面量** ——
   *  字面量每輪變更偵測都會產生新物件，讓 signal input 每次都判定為「變了」。 */
  protected readonly primaryAction: PageAction = { label: '新增人員', icon: 'pi pi-plus' };

  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly staffService = inject(StaffService);

  /** 搜尋輸入 —— 節流 + 去重之後才進 `loadStaff()`（#661） */
  private readonly searchInput = new RxSubject<string>();
  /**
   * **所有**取數都經過這裡，然後 `switchMap` 出去。
   *
   * `debounce` 只解一半：打字慢的人（每次間隔超過 300ms）仍然會送出多支請求，
   * 而它們回來的順序不保證 —— **先發的後到就會蓋掉畫面**，而畫面上的輸入框
   * 顯示的是最新的字。一次打完「李語涵」四個字回 4 筆（那是「李」的結果集）
   * 就是這樣來的，**而且它不會自己追上**：沒有任何後續事件會重查。
   *
   * 讓每一個取數都走同一條 `switchMap`，新的一發就取消舊的那一支。
   */
  private readonly loadRequests = new RxSubject<void>();
  private readonly campusesService = inject(CampusesService);
  private readonly subjectsService = inject(SubjectsService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly refData = inject(ReferenceDataService);
  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // Constants exposed to template
  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly secondaryAction: PageAction = { label: '操作紀錄', icon: 'pi pi-history' };

  // State
  readonly staffList = signal<Staff[]>([]);
  readonly campuses = signal<Campus[]>([]);
  readonly subjects = signal<Subject[]>([]);
  readonly loading = signal(true);

  /**
   * 取數失敗。**跟「清單長度 0」是兩件事** —— 錯誤被吃掉之後兩者在狀態上相同，
   * 而畫面只看狀態，於是失敗被渲染成「尚未有資料」（#788）。
   */
  protected readonly loadFailed = signal(false);
  readonly searchQuery = signal('');
  readonly roleFilter = signal<StaffRole | null>(null);
  /** 分校跟頂欄走（#1138）：頁內分校篩選拿掉 */
  private readonly campusCtx = inject(CampusContextService);
  readonly campusFilter = this.campusCtx.id;
  readonly subjectFilter = signal<string | null>(null);
  protected readonly staffStatusFilter = signal<StaffStatusFilter>('live');
  readonly summary = signal<StaffSummary>({
    total: 0,
    adminCount: 0,
    teacherCount: 0,
    multiRoleCount: 0,
    activeCount: 0,
    inactiveCount: 0,
    archivedCount: 0,
    byRole: { admin: 0, teacher: 0, kiosk: 0, inactiveOrArchived: 0 },
  });

  // Computed
  readonly adminCount = computed(() => this.summary().adminCount);
  readonly teacherCount = computed(() => this.summary().teacherCount);
  readonly multiRoleCount = computed(() => this.summary().multiRoleCount);

  /**
   * 依角色分章（#1314 ST1）。列表一次拿全部，所以在這裡歸桶；歸法與後端 `byRole` 同定義
   * （在職且有 admin｜在職且只有 teacher｜在職 kiosk｜停用＋封存），兼任歸管理員章。
   * 章名張數讀 `summary.byRole`（走同一組篩選，不用前端數列）；沒有列的章不顯示。
   */
  protected readonly chapters = computed<StaffChapter[]>(() => {
    const rows = this.visibleRows();
    const by = this.summary().byRole;
    // 不含封存時，「停用」章的張數是 `inactiveCount`（byRole 那桶把封存也算進去）
    const inactiveTally = this.hideArchived()
      ? this.summary().inactiveCount
      : by.inactiveOrArchived;
    // 明確選了某個狀態時，`byRole` 不吃狀態篩選（實機：選「已停用」章名寫 2、底下只有 1 列），
    // 這時列表本來就是完整的一次取回（pageSize=0），章名直接數列
    const status = this.staffStatusFilter();
    const countRows = status === 'active' || status === 'inactive' || status === 'archived';
    const bucket = (s: Staff): StaffChapterKey =>
      s.status !== 'active'
        ? 'inactive'
        : s.roles.includes('admin')
          ? 'admin'
          : isKiosk(s)
            ? 'kiosk'
            : 'teacher';
    const grouped: Record<StaffChapterKey, Staff[]> = {
      admin: [],
      teacher: [],
      kiosk: [],
      inactive: [],
    };
    for (const s of rows) grouped[bucket(s)].push(s);
    const hasArchived = grouped.inactive.some((s) => s.status === 'archived');
    const defs: [StaffChapterKey, string, number][] = [
      ['admin', '管理員', by.admin],
      ['teacher', '老師', by.teacher],
      ['kiosk', '掃碼機台', by.kiosk],
      ['inactive', hasArchived ? '停用與封存' : '已停用', inactiveTally],
    ];
    return defs
      .filter(([key]) => grouped[key].length > 0)
      .map(([key, label, count]) => ({
        key,
        label,
        count: countRows ? grouped[key].length : count,
        rows: grouped[key],
      }));
  });

  /** `live` 狀態（預設）不顯示封存的人 */
  private readonly hideArchived = computed(() => this.staffStatusFilter() === 'live');
  protected readonly visibleRows = computed(() =>
    this.hideArchived()
      ? this.staffList().filter((s) => s.status !== 'archived')
      : this.staffList(),
  );

  /** 手機的「篩選：全部」面板開合與摘要；桌機也渲染（A6 的篩選鈕） */
  protected readonly filtersOpen = signal(false);
  protected readonly hasFilter = computed(
    () =>
      this.roleFilter() !== null ||
      this.subjectFilter() !== null ||
      this.staffStatusFilter() !== 'live',
  );
  /** 搜尋或任何篩選生效：標題改「符合篩選的 N 位」，名冊上方出現「N 位符合 · 清除篩選」 */
  protected readonly narrowed = computed(() => this.searchQuery() !== '' || this.hasFilter());
  protected readonly filterSummary = computed(() => {
    const role = this.roleFilter();
    const subject = this.subjectFilter();
    const status = this.staffStatusFilter();
    const parts = [
      role ? this.getRoleLabel(role) : '',
      subject ? (this.subjects().find((x) => x.id === subject)?.name ?? '') : '',
      status === 'live' ? '' : STATUS_OPTIONS.find((o) => o.value === status)!.label,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '全部';
  });

  /** 篩選面板的三列（A6：角色、教學科目、狀態；分校跟頂欄走，不在這裡） */
  protected readonly filterGroups = computed(() => [
    {
      key: 'role' as const,
      label: '角色',
      selected: this.roleFilter() as string | null,
      options: [{ value: null as string | null, label: '全部' }, ...ROLE_OPTIONS],
    },
    {
      key: 'subject' as const,
      label: '科目',
      selected: this.subjectFilter(),
      options: [{ value: null as string | null, label: '全部' }, ...this.subjectOptions()],
    },
    {
      key: 'status' as const,
      label: '狀態',
      selected: this.staffStatusFilter() as string | null,
      options: STATUS_OPTIONS as { value: string | null; label: string }[],
    },
  ]);

  protected onFilterPick(key: 'role' | 'subject' | 'status', value: string | null): void {
    if (key === 'role') this.onRoleFilterChange(value as StaffRole | null);
    else if (key === 'subject') this.onSubjectFilterChange(value);
    else this.onStaffStatusFilterChange((value ?? 'live') as StaffStatusFilter);
  }

  /** 標題數字句：N 位人員（不含封存），M 位啟用中 */
  protected readonly liveTotal = computed(
    () => this.summary().total - this.summary().archivedCount,
  );

  /** 開場副行：N 位管理員 · N 位老師（N 位身兼兩者） */
  protected readonly openSub = computed(() => {
    const s = this.summary();
    const both = s.multiRoleCount > 0 ? `（${s.multiRoleCount} 位身兼兩者）` : '';
    return `${s.adminCount} 位管理員 · ${s.teacherCount} 位老師${both}`;
  });

  // Action menu
  protected readonly actionMenu = viewChild.required<PopupMenuComponent>('actionMenu');
  protected readonly selectedStaff = signal<Staff | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const staff = this.selectedStaff();
    if (!staff) return [];
    const kiosk = isKiosk(staff);
    const items: MenuItem[] = [
      {
        label: '編輯',
        icon: 'pi pi-pencil',
        command: () => (kiosk ? this.openKioskDialog(staff) : this.openEditDialog(staff)),
      },
      // 機台不上課
      ...(kiosk
        ? []
        : [
            {
              label: '授課紀錄',
              icon: 'pi pi-history',
              command: () => this.openTeachingLog(staff),
            },
          ]),
      {
        label: '產生登入連結',
        icon: 'pi pi-qrcode',
        disabled: staff.status === 'archived',
        command: () => this.issueLoginLink(staff),
      },
      { separator: true },
    ];
    if (staff.status === 'inactive') {
      items.push({
        label: '重新啟用',
        icon: 'pi pi-unlock',
        command: () => this.confirmDeactivate(staff),
      });
    } else if (staff.status === 'active') {
      items.push({
        label: '停用帳號',
        icon: 'pi pi-lock',
        command: () => this.confirmDeactivate(staff),
      });
    }
    if (staff.status !== 'archived') {
      items.push({
        label: '封存帳號',
        icon: 'pi pi-box',
        command: () => this.confirmArchive(staff),
      });
    }
    return items;
  });

  private openLoginLinkDialog(staff: Staff, loginUrl: string): void {
    this.dialogService.open(LoginLinkDialogComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      // **對象要標出來**（#666 之二）：那支對話框是為家長流程設計的
      // （檔頭註解逐字寫著「家長本人在場」），措辭預設也是家長版。
      // 不標的話職員會被叫去「用自己的手機掃描」。
      // 機台的 QR 是給門口平板掃的，不是給人（#1127）
      data: {
        loginUrl,
        personName: staff.displayName,
        audience: isKiosk(staff) ? ('kiosk' as const) : ('staff' as const),
      },
    });
  }

  /**
   * 重發登入連結。取代原本「告知初始密碼」那條路 —— 這個系統沒有密碼了。
   * 連結會過期、只能用一次；密碼會被寫在便條紙上留著。
   */
  protected issueLoginLink(staff: Staff): void {
    if (!staff.userId) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法產生',
        detail: '這位人員還沒有帳號，無法產生連結',
      });
      return;
    }

    this.staffService.createLoginLink(staff.userId).subscribe({
      next: (res) => this.openLoginLinkDialog(staff, res.url),
      // 403（權限或分校範圍不夠，#464／#966）是永久拒絕 —— 顯示伺服器說的原因，不叫人「稍後再試」
      // （loginLinkErrorDetail 對 403 優先採伺服器訊息；其餘錯誤碼給可行動文案，#1006）
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '產生失敗',
          detail: loginLinkErrorDetail(err, '人員'),
        });
      },
    });
  }

  protected openActionMenu(event: MouseEvent, staff: Staff): void {
    this.selectedStaff.set(staff);
    this.actionMenu().toggle(event);
  }

  readonly subjectOptions = computed(() =>
    this.subjects().map((subject) => ({ value: subject.id, label: subject.name })),
  );

  constructor() {
    this.campusCtx.use();
    // 初次載入由 ngOnInit 做；這裡只管之後頂欄換分校
    toObservable(this.campusFilter)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.loadStaff();
      });
  }

  ngOnInit(): void {
    this.setupLoadPipeline();

    // 搜尋：節流 + 去重，然後才觸發取數。
    // 去重擋的是「同一個字重複送」——中文輸入法組字過程中送出同樣的中間值，
    // 或使用者貼上同樣的內容。
    //
    // **去重比對的是 `searchQuery` signal，不是 `distinctUntilChanged`。**
    // `distinctUntilChanged` 的記憶住在管線裡，是這個狀態的第二份複本，
    // 而 `clearFilters()` 直接 `searchQuery.set('')` 不經過這條管線 ——
    // 清完篩選再打一次同樣的字，管線會認為「跟上次一樣」而整個吞掉，
    // **搜尋框有字、列表卻是未篩選的全部**。比對 signal 沒有第二份複本可以脫鉤。
    this.searchInput
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (value === this.searchQuery()) return;
        this.searchQuery.set(value);
        this.loadStaff();
      });

    this.loadFilterOptions();
    this.loadStaff();
  }

  private loadFilterOptions(): void {
    this.campusesService.list({ pageSize: 100 }).subscribe({
      next: (res: { data: Campus[] }) => this.campuses.set(res.data),
      error: (err: any) => console.error('Failed to load campuses', err),
    });

    this.subjectsService.list().subscribe({
      next: (res: { data: Subject[] }) => this.subjects.set(res.data),
      error: (err: any) => console.error('Failed to load subjects', err),
    });
  }

  /** 觸發取數。實際的請求在 `ngOnInit` 的那條 `switchMap` 管線裡（#661） */
  protected loadStaff(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.loadRequests.next();
  }

  private setupLoadPipeline(): void {
    this.loadRequests
      .pipe(
        switchMap(() =>
          this.staffService
            .list({
              search: this.searchQuery() || undefined,
              role: this.roleFilter() || undefined,
              campusId: this.campusFilter() || undefined,
              subjectId: this.subjectFilter() || undefined,
              status: this.apiStatus(),
              // 人員量級小（一個組織幾十到一百多人），一次拿全部好分章。
              // ponytail: 沒有 max_rows 保護，超過 1000 會被靜默截斷；真有那麼多人再改伺服器分頁
              pageSize: 0,
            })
            // **`catchError` 必須在內層，不能掛在外層 `pipe` 上。**
            // 所有取數收進單一管線之後，內層的 error 會終止外層 ——
            // **一次網路錯誤就讓這一頁再也載入不了任何東西**，而畫面上只有一則
            // toast，看起來像「這次失敗了」不是「這一頁壞了」。
            // 由 spec 的「一次請求失敗之後…」那條釘住（#689）。
            .pipe(
              catchError((err: unknown) => {
                console.error('Failed to load staff', err);
                // **不再發 toast** —— 主體現在有常駐的失敗狀態（照 /admin/payments）。
                // 會消失的 toast + 留著的錯誤畫面＝兩個互相矛盾的訊號（#788）。
                this.loadFailed.set(true);
                this.loading.set(false);
                // `EMPTY` 照舊 —— #689 的修法，拆掉整條管線會死在第一次錯誤上。
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res: StaffListResponse) => {
        this.staffList.set(res.data);
        this.summary.set(res.summary);
        this.loading.set(false);
      });
  }

  protected onSearchChange(value: string): void {
    this.searchInput.next(value);
  }

  protected onRoleFilterChange(value: StaffRole | null): void {
    this.roleFilter.set(value);
    this.loadStaff();
  }

  protected onSubjectFilterChange(value: string | null): void {
    this.subjectFilter.set(value);
    this.loadStaff();
  }

  private apiStatus(): StaffStatus | undefined {
    const status = this.staffStatusFilter();
    return status === 'live' || status === 'all' ? undefined : status;
  }

  protected onStaffStatusFilterChange(value: StaffStatusFilter): void {
    this.staffStatusFilter.set(value);
    this.loadStaff();
  }

  openCreateDialog(): void {
    const ref = this.dialogService.open(StaffFormDialogComponent, {
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        campuses: this.campuses(),
        subjects: this.subjects(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result?: { data?: Staff; loginUrl?: string | null }) =>
        this.afterCreate(result),
      );
  }

  /** 新增人員與新增機台共用：刷新列表，然後當場給登入 QR */
  private afterCreate(result?: { data?: Staff; loginUrl?: string | null }): void {
    if (!result) return;
    this.refData.invalidate('teachers');
    this.loadStaff();

    // 建完立刻給連結：櫃檯把 QR 給對方掃，是綁定成功率最高的時刻
    if (result.data && result.loginUrl) {
      this.openLoginLinkDialog(result.data, result.loginUrl);
    } else if (result.data) {
      // 後端 mint 失敗時 loginUrl 是 null —— 不說的話櫃檯不知道連結沒出來（#1028）
      this.messageService.add({
        severity: 'warn',
        summary: isKiosk(result.data) ? '機台已建立' : '人員已建立',
        detail: '但登入連結沒產生：請到列表用「產生登入連結」重試',
      });
    }
  }

  /** 新增（沒帶 staff）或編輯掃碼機台（#1127） */
  openKioskDialog(staff?: Staff): void {
    const ref = this.dialogService.open(KioskFormDialogComponent, {
      width: 'min(480px, 90%)',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { campuses: this.campuses(), staff },
    });

    if (ref)
      ref.onClose.subscribe((result?: KioskFormDialogResult) => {
        if (!result) return;
        if (staff) {
          this.loadStaff();
        } else {
          this.afterCreate(result);
        }
      });
  }

  /** 唯讀的授課紀錄檢視。不計算薪資，只呈現這位老師某段期間上了哪些課。 */
  openTeachingLog(staff: Staff): void {
    this.dialogService.open(TeachingLogDialogComponent, {
      header: `授課紀錄 · ${staff.displayName}`,
      width: '760px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: { staffId: staff.id, staffName: staff.displayName },
    });
  }

  openEditDialog(staff: Staff): void {
    const ref = this.dialogService.open(StaffFormDialogComponent, {
      width: '600px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        staff,
        campuses: this.campuses(),
        subjects: this.subjects(),
      },
    });

    if (ref)
      ref.onClose.subscribe((result) => {
        if (result) {
          this.refData.invalidate('teachers');
          this.loadStaff();
        }
      });
  }

  /** 「權限 N 項」：唯讀清單（#1314 ST2），不給編輯 */
  protected openPermissionList(staff: Staff): void {
    this.dialogService.open(PermissionListDialogComponent, {
      width: 'min(480px, 90%)',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { staffName: staff.displayName, permissions: staff.permissions },
    });
  }

  /** 姓名＝編輯入口（A6 / 規格「點擊進入編輯」） */
  protected openEdit(staff: Staff): void {
    if (isKiosk(staff)) this.openKioskDialog(staff);
    else this.openEditDialog(staff);
  }

  protected getSubjectsText(staff: Staff): string {
    return staff.roles.includes('teacher') && staff.subjectNames.length > 0
      ? staff.subjectNames.join('、')
      : '—';
  }

  /** 頁面的「⋯」：現況有、A6 沒畫的「新增掃碼機台」收在這裡 */
  protected readonly pageMenuItems: MenuItem[] = [
    { label: '新增掃碼機台', icon: 'pi pi-qrcode', command: () => this.openKioskDialog() },
  ];

  openAuditLog(): void {
    this.dialogService.open(AuditLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: {
        resourceTypes: ['staff'],
      },
    });
  }

  confirmArchive(staff: Staff): void {
    this.openConfirmDialog(
      '確認封存',
      {
        message: `確定要封存「${staff.displayName}」嗎？封存後無法取消，帳號將永久停用且無法登入，未來課堂指派將自動解除，但歷史紀錄會保留。`,
        acceptLabel: '封存',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => this.archiveStaff(staff),
    );
  }

  private archiveStaff(staff: Staff): void {
    this.staffService.archive(staff.id).subscribe({
      next: (res) => {
        const detail =
          res.unassignedSessions > 0
            ? `「${staff.displayName}」已封存，${res.unassignedSessions} 堂未來課堂已設為待指派`
            : `「${staff.displayName}」已封存`;
        this.messageService.add({ severity: 'success', summary: '封存成功', detail });
        this.refData.invalidate('teachers');
        this.loadStaff();
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: '封存失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  protected confirmDeactivate(staff: Staff): void {
    if (staff.status === 'inactive') {
      this.openConfirmDialog(
        '確認啟用',
        {
          message: `確定要重新啟用「${staff.displayName}」嗎？`,
          acceptLabel: '啟用',
          rejectLabel: '取消',
          acceptSeverity: 'success',
        },
        () => this.reactivateStaff(staff),
      );
      return;
    }

    this.openConfirmDialog(
      '確認停用',
      {
        message: `確定要停用「${staff.displayName}」嗎？停用後帳號將暫時無法使用，但角色與課堂指派會保留。`,
        acceptLabel: '停用',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
      },
      () => this.deactivateStaff(staff),
    );
  }

  private deactivateStaff(staff: Staff): void {
    this.staffService.deactivate(staff.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '停用成功',
          detail: `「${staff.displayName}」已停用`,
        });
        this.refData.invalidate('teachers');
        this.loadStaff();
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: '停用失敗',
          detail: err.error?.error || '請稍後再試',
        });
      },
    });
  }

  private reactivateStaff(staff: Staff): void {
    this.staffService.activate(staff.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: '啟用成功',
          detail: `「${staff.displayName}」已重新啟用`,
        });
        this.refData.invalidate('teachers');
        this.loadStaff();
      },
      error: (err: any) => {
        this.messageService.add({
          severity: 'error',
          summary: '啟用失敗',
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

  protected getStaffStatusText(status: StaffStatus): string {
    return STATUS_TEXT[status];
  }

  getCampusNames(campusIds: string[]): string {
    const campusMap = new Map(this.campuses().map((c) => [c.id, c.name]));
    return campusIds.map((id) => campusMap.get(id) || '未知').join('、');
  }

  getRoleLabel(role: StaffRole): string {
    return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.roleFilter.set(null);
    this.subjectFilter.set(null);
    this.staffStatusFilter.set('live');
    this.loadStaff();
  }

  onSubjectsChanged(updated: Subject[]): void {
    this.subjects.set(updated);
  }

  getDisplaySubjects(subjectNames: string[]): { visible: string[]; remaining: number } {
    const maxVisible = 2;
    if (subjectNames.length <= maxVisible) {
      return { visible: subjectNames, remaining: 0 };
    }
    return {
      visible: subjectNames.slice(0, maxVisible),
      remaining: subjectNames.length - maxVisible,
    };
  }
}
