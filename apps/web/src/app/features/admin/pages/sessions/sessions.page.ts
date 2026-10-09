import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';
import { DatePipe } from '@angular/common';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { CampusContextService } from '@core/campus-context.service';
import { CampusScopeNoteComponent } from '@shared/components/campus-scope-note/campus-scope-note.component';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { MessageService, type MenuItem } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DialogService } from 'primeng/dynamicdialog';

import type { Campus } from '@core/campuses.service';
import { ClassesService } from '@core/classes.service';
import { CoursesService, type Course } from '@core/courses.service';
import { EnrollmentsService, type Enrollment } from '@core/enrollments.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { SessionsService, type Session, type SessionQueryParams } from '@core/sessions.service';
import type { Staff } from '@core/staff.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { StudentsService, type Student } from '@core/students.service';
import {
  SessionAdvancedFiltersDialogComponent,
  type SessionAdvancedFiltersDialogResult,
} from '@shared/components/session-advanced-filters-dialog/session-advanced-filters-dialog.component';

import { SessionCancelDialogComponent } from './dialogs/session-cancel-dialog/session-cancel-dialog.component';
import { parseAttendanceQueryParams, parseClassQueryParams } from './sessions.util';
import { AttendanceRosterPanelComponent } from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { LoadFailedComponent } from '@shared/components/load-failed/load-failed.component';
import { SessionDetailDialogComponent } from './dialogs/session-detail-dialog/session-detail-dialog.component';
import { SessionOperationsLogDialogComponent } from './dialogs/session-operations-log-dialog/session-operations-log-dialog.component';
import { SessionRescheduleDialogComponent } from './dialogs/session-reschedule-dialog/session-reschedule-dialog.component';
import { SessionAssignDialogComponent } from './dialogs/session-assign-dialog/session-assign-dialog.component';
import { SessionSubstituteDialogComponent } from './dialogs/session-substitute-dialog/session-substitute-dialog.component';
import { SessionMakeupDialogComponent } from './dialogs/session-makeup-dialog/session-makeup-dialog.component';
import {
  MobileFilterDialogComponent,
  type MobileFilterDialogData,
  type MobileFilterDialogResult,
} from './dialogs/mobile-filter-dialog/mobile-filter-dialog.component';
import {
  MobileBatchDialogComponent,
  type MobileBatchDialogData,
  type MobileBatchDialogResult,
} from './dialogs/mobile-batch-dialog/mobile-batch-dialog.component';
import {
  SessionFiltersComponent,
  ALL_SESSION_STATUSES,
  DEFAULT_STATUSES,
  statusesAreFiltering,
} from './components/session-filters/session-filters.component';
import { SessionsHeaderComponent } from './components/sessions-header/sessions-header.component';
import { PopupMenuComponent } from '@shared/components/popup-menu/popup-menu.component';
import {
  SessionBatchComponent,
  type BatchMode,
} from './components/session-batch/session-batch.component';
import {
  ScheduleGanttComponent,
  type ScheduleMenuRequest,
  type SchedulePickRequest,
} from './components/schedule-gantt/schedule-gantt.component';
import { ScheduleListComponent } from './components/schedule-list/schedule-list.component';
import { ScheduleQuickPicksComponent } from './components/schedule-quick-picks/schedule-quick-picks.component';
import { ScheduleChangesDrawerComponent } from './components/schedule-changes-drawer/schedule-changes-drawer.component';
import { ScheduleQuickSheetComponent } from './components/schedule-quick-sheet/schedule-quick-sheet.component';
import {
  groupByDate,
  groupByStart,
  layoutDay,
  pickRange,
  summarizeWeek,
  type WeekDaySummary,
} from './schedule-day.util';
import { SessionsActionsService } from './services/sessions-actions.service';
import { todayLocal } from '@shared/utils/session-time.util';

interface AttendanceDialogCloseResult {
  readonly eventId: string;
  readonly takenAt: string;
  readonly presentCount: number;
  readonly absentCount: number;
  readonly onLeaveCount: number;
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
// ponytail: 甘特、週視圖與篩選結果都不分頁，一次最多 500 堂（一天、一週、一班整期、一個月的未指派都遠低於此）；
// 超過時色面照實寫總數、清單只畫前 500 —— 真的撞到再改成依日期分段取。
const FETCH_LIMIT = 500;

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [
    CampusScopeNoteComponent,
    ToastModule,
    PopupMenuComponent,
    SessionsHeaderComponent,
    DatePipe,
    SessionBatchComponent,
    ScheduleGanttComponent,
    ScheduleListComponent,
    ScheduleQuickPicksComponent,
    ScheduleQuickSheetComponent,
    ScheduleChangesDrawerComponent,
    RouterLink,
    SessionFiltersComponent,
    LoadFailedComponent,
    PageOpenComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './sessions.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsPage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly refData = inject(ReferenceDataService);
  private readonly classesService = inject(ClassesService);
  private readonly coursesService = inject(CoursesService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly sessionsService = inject(SessionsService);
  private readonly sessionsActionsService = inject(SessionsActionsService);
  private readonly messageService = inject(MessageService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly dialogService = inject(DialogService);
  private readonly studentsService = inject(StudentsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  // ── View state ─────────────────────────────────────────────────────────
  protected readonly loading = signal(false);
  /** 第一次讀完之前色面不寫數字（不然會先閃一個「0 堂課」） */
  protected readonly loadedOnce = signal(false);

  /**
   * 取數失敗。#791 把這一頁標為最嚴重的一支：5 個請求全部失敗，
   * 而畫面只說「此期間沒有課堂」—— **沒有 toast、沒有 empty-state、
   * 沒有任何錯誤字樣**。課堂管理是每天在用的頁，取數失敗會讓人以為那天沒排課（#788）。
   */
  protected readonly loadFailed = signal(false);
  protected readonly sessions = signal<Session[]>([]);

  // Filter options — campuses & teachers come from shared cache
  protected readonly campuses = computed(() => this.refData.campuses());
  protected readonly courses = signal<Course[]>([]);
  protected readonly staff = computed(() => this.refData.teachers());
  protected readonly classes = signal<
    Array<{ id: string; name: string; courseId: string; campusId: string }>
  >([]);

  private readonly sessionMenuRef = viewChild<PopupMenuComponent>('sessionMenu');

  // ── Filter state ───────────────────────────────────────────────────────
  /**
   * 分校跟頂欄走（#1138 H2，CampusContextService）：頁內不再有分校下拉。`[]`＝全部分校。
   * 以前預設是第一間分校；現在是上次在頂欄選的那間，沒選過就是全部。
   */
  private readonly campusCtx = inject(CampusContextService);
  protected readonly selectedCampusIds = computed(() => {
    const id = this.campusCtx.id();
    return id ? [id] : [];
  });
  protected readonly selectedCampusId = computed(() => this.selectedCampusIds()[0] ?? null);
  protected readonly selectedCampusName = computed(() => {
    const id = this.selectedCampusId();
    if (!id) return null;
    return this.campuses().find((c) => c.id === id)?.name ?? null;
  });
  protected readonly selectedCourseIds = signal<string[]>([]);
  protected readonly selectedTeacherIds = signal<string[]>([]);
  protected readonly selectedClassIds = signal<string[]>([]);
  protected readonly selectedStudentIds = signal<string[]>([]);
  /** 甘特預設**顯示停課**（#1174 Q2：停課是課表的一部分，虛線課塊）；工具列一鍵隱藏 */
  protected readonly selectedStatuses = signal<string[]>([...ALL_SESSION_STATUSES]);
  protected readonly totalSessions = signal(0);
  protected readonly students = signal<Student[]>([]);
  protected readonly studentEnrolledClassIds = signal<Set<string>>(new Set());
  protected readonly studentFilteredEnrollments = signal<Enrollment[]>([]);

  // ── List date range ────────────────────────────────────────────────────
  protected readonly listDateRange = signal<Date[]>([
    startOfMonth(new Date()),
    endOfMonth(new Date()),
  ]);
  protected readonly listDateRangeModified = signal(false);

  // ── 課表（#1174 G1／G2）：單日甘特或一週七欄；別頁帶範圍條件進來時切「篩選結果」 ──────────
  /**
   * `day`＝一天的甘特（手機是依開始時間分組的清單）；`week`＝一週每天一欄（手機每天一行）；
   * `results`＝範圍條件的篩選結果（依日期分章）
   */
  protected readonly mode = signal<'day' | 'week' | 'results'>('day');
  protected readonly day = signal<Date>(startOfDay(new Date()));
  /** 「現在」：每次取數時更新一次（上課中、現在線用）；不掛計時器 */
  protected readonly now = signal(new Date());
  protected readonly isToday = computed(() => isSameDay(this.day(), this.now()));
  protected readonly dayName = computed(() =>
    this.isToday() ? '今天' : `週${WEEKDAY[this.day().getDay()]} ${format(this.day(), 'M/d')}`,
  );
  protected readonly layout = computed(() => layoutDay(this.displayedSessions()));
  protected readonly clashIds = computed(() => this.layout()?.clashIds ?? new Set<string>());
  protected readonly dayGroups = computed(() => groupByStart(this.displayedSessions()));
  protected readonly resultChapters = computed(() => groupByDate(this.displayedSessions()));
  protected readonly week = computed(() =>
    summarizeWeek(
      this.weekDays().map((d) => format(d, 'yyyy-MM-dd')),
      this.displayedSessions(),
    ),
  );
  protected readonly isThisWeek = computed(() =>
    isSameDay(this.weekDays()[0], startOfWeek(this.now(), { weekStartsOn: 1 })),
  );
  /** 工具列的週區間字（`9/28 – 10/4`） */
  protected readonly weekLabel = computed(() => {
    const d = this.weekDays();
    return `${format(d[0], 'M/d')} – ${format(d[6], 'M/d')}`;
  });
  /** 一次最多拿幾堂（甘特與篩選結果都不分頁） */
  protected readonly FETCH_LIMIT = FETCH_LIMIT;
  /** 色面標題用的區間（`10/1–10/31`）；只選了起日時只寫一天 */
  protected readonly rangeLabel = computed(() => {
    const [from, to] = this.listDateRange();
    if (!from) return '';
    return to ? `${format(from, 'M/d')}–${format(to, 'M/d')}` : format(from, 'M/d');
  });
  protected readonly headline = computed(() => {
    if (this.mode() === 'results') {
      const range = this.rangeLabel();
      return `${range ? range + '，' : ''}符合篩選的 ${this.displayedTotal()} 堂課。`;
    }
    if (this.mode() === 'week') {
      const days = this.week();
      const name = this.isThisWeek() ? '這週' : `${this.weekLabel()} 這週`;
      const live = days.reduce((n, d) => n + d.sessions.length - d.cancelled, 0);
      const changed = days.reduce((n, d) => n + d.changed, 0);
      if (live === 0)
        return days.some((d) => d.cancelled) ? `${name}全部停課。` : `${name}沒有排課。`;
      return `${name} ${live} 堂課，${changed ? `${changed} 堂有異動。` : '沒有異動。'}`;
    }
    const all = this.displayedSessions();
    if (all.length === 0) return `${this.dayName()}沒有排課。`;
    const live = all.filter((s) => s.status !== 'cancelled').length;
    if (live === 0) return `${this.dayName()} ${all.length} 堂全部停課。`;
    const clash = this.clashIds();
    const changed = all.filter(
      (s) => s.status === 'cancelled' || s.hasChanges || clash.has(s.id),
    ).length;
    return `${this.dayName()} ${live} 堂課，${changed ? `${changed} 堂有異動。` : '沒有異動。'}`;
  });

  /**
   * 有沒有點名過——從別頁（目前是儀表板的未點名卡）連過來時帶的篩選。
   * `undefined` 是「沒有這個篩選」，不是「false」。
   */
  protected readonly attendanceTakenFilter = signal<boolean | undefined>(undefined);

  /**
   * 只篩「已經上完」的課堂——配 `attendanceTakenFilter() === false` 一次表達
   * 「沒點名而且已經上完」，落地頁看到的堂數才對得上儀表板卡片的數字（不含
   * 今天還在進行中、還沒到點名時間的課）。沒有「undefined vs false」的區分
   * ——API 這個參數只吃 `true` 或不帶，false 就是不篩，跟預設狀態相同。
   */
  protected readonly endedOnlyFilter = signal(false);

  // ── Computed ───────────────────────────────────────────────────────────
  protected readonly activeTeachers = computed(() =>
    this.staff().filter((s) => s.roles.includes('teacher')),
  );

  protected readonly availableCourses = computed(() => {
    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) return this.courses();
    return this.courses().filter((c) => campusIds.includes(c.campusId));
  });

  protected readonly availableTeachers = computed(() => {
    const campusIds = this.selectedCampusIds();
    if (campusIds.length === 0) return this.activeTeachers();

    let filtered = this.activeTeachers().filter((t) =>
      t.campusIds.some((cid) => campusIds.includes(cid)),
    );

    const courseIds = this.selectedCourseIds();
    if (courseIds.length > 0) {
      const selectedCourses = this.courses().filter((c) => courseIds.includes(c.id));
      const subjectIds = new Set(selectedCourses.map((c) => c.subjectId));
      filtered = filtered.filter((t) => t.subjectIds.some((sid) => subjectIds.has(sid)));
    }
    return filtered;
  });

  protected readonly availableClasses = computed(() => {
    const courseIds = this.selectedCourseIds();
    const campusIds = this.selectedCampusIds();
    if (courseIds.length === 0) return [];
    return this.classes().filter(
      (c) =>
        courseIds.includes(c.courseId) &&
        (campusIds.length === 0 || campusIds.includes(c.campusId)),
    );
  });

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedCourseIds().length > 0) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.selectedClassIds().length > 0) count++;
    if (this.selectedStudentIds().length > 0) count++;
    // 預設值本身就在濾掉已停課，所以它**是**一個生效中的條件（#640）。
    // 判準是「有沒有在濾」而不是「跟預設一不一樣」——見 shared/utils/session-status.ts。
    if (statusesAreFiltering(this.selectedStatuses())) count++;
    return count;
  });

  protected readonly hasActiveFilters = computed(
    () =>
      this.selectedCourseIds().length > 0 ||
      this.selectedTeacherIds().length > 0 ||
      this.selectedClassIds().length > 0 ||
      this.selectedStudentIds().length > 0 ||
      // **這裡刻意仍然是「跟預設一不一樣」，跟上面的 activeFilterCount 不同判準。**
      // 這個 signal 控的是「清除篩選」按鈕，而清除的目標就是回到預設 ——
      // 用 `statusesAreFiltering` 的話按鈕在預設態就會出現，而按下去什麼都不會變。
      !this.isDefaultStatuses(),
  );

  /** 目前狀態篩選正在隱藏幾堂已停課（#640）。0 = 沒有東西被隱藏，badge 不渲染 */
  protected readonly hiddenCancelledCount = signal(0);
  protected readonly monthUnassignedCount = signal(0);
  protected readonly todayPendingAttendanceCount = signal(0);
  protected readonly displayedSessions = computed(() => {
    if (this.selectedStudentIds().length === 0) {
      return this.sessions();
    }

    const enrollments = this.studentFilteredEnrollments();
    const classIds = this.studentEnrolledClassIds();
    if (classIds.size === 0 || enrollments.length === 0) {
      return [];
    }

    return this.sessions().filter(
      (session) =>
        classIds.has(session.classId) && this.hasMatchingStudentEnrollment(session, enrollments),
    );
  });
  protected readonly displayedTotal = computed(() =>
    this.selectedStudentIds().length > 0 ? this.displayedSessions().length : this.totalSessions(),
  );

  // ── Selection state ────────────────────────────────────────────────────
  protected readonly selectedIds = signal<Set<string>>(new Set());
  /** 勾過的課的資料（批次對話框要知道有沒有停課、能指派哪些老師；勾到的課不一定在畫面上） */
  private readonly known = new Map<string, Session>();
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  protected readonly selectedSessions = computed(() => {
    const selected = this.selectedIds();
    if (selected.size === 0) return [];
    // 快速選取勾的課可能不在畫面上（別天、整期）：從勾的當下記下來的那份補
    const shown = new Map(this.displayedSessions().map((s) => [s.id, s]));
    return [...selected]
      .map((id) => shown.get(id) ?? this.known.get(id))
      .filter((s): s is Session => !!s);
  });
  protected readonly hasCancelledSelection = computed(() =>
    this.selectedSessions().some((session) => session.status === 'cancelled'),
  );
  protected readonly batchAssignableTeachers = computed(() => {
    const sessions = this.selectedSessions();
    if (sessions.length === 0) return [];
    const courseSubjectMap = new Map(this.courses().map((course) => [course.id, course.subjectId]));
    return this.activeTeachers().filter((teacher) =>
      sessions.every((session) => {
        const subjectId = courseSubjectMap.get(session.courseId);
        if (!subjectId) return false;
        return (
          teacher.campusIds.includes(session.campusId) && teacher.subjectIds.includes(subjectId)
        );
      }),
    );
  });

  // ── Context menu ───────────────────────────────────────────────────────
  protected readonly contextSession = signal<Session | null>(null);
  protected readonly contextMenuItems = computed<MenuItem[]>(() => {
    const s = this.contextSession();
    if (!s) return [];
    const items: MenuItem[] = [
      { label: '查看異動紀錄', icon: 'pi pi-eye', command: () => this.openDetail(s) },
      {
        label: '管理出勤狀況',
        icon: 'pi pi-id-card',
        // UTC 日期會讓半夜的「今天」被當成未來，選項會被錯誤 disable
        // `eventId === null` 是停課（沒有出勤事件可點，#123）
        disabled: s.sessionDate > todayLocal() || s.eventId === null,
        command: () => this.openAttendance(s),
      },
    ];
    if (s.status === 'scheduled') {
      items.push({ label: '調課', icon: 'pi pi-arrows-h', command: () => this.openReschedule(s) });
    }
    if (s.status === 'scheduled' && s.assignmentStatus === 'assigned') {
      items.push({ label: '代課', icon: 'pi pi-user-edit', command: () => this.openSubstitute(s) });
    }
    if (s.assignmentStatus === 'unassigned' && s.status === 'scheduled') {
      items.push({
        label: '指派老師',
        icon: 'pi pi-user-plus',
        command: () => this.openAssignSingle(s),
      });
    }
    if (s.status === 'scheduled') {
      // **這是「指定」不是「新增」**（#592）：把這堂已排定的課，指定成某堂停課的補課。
      // 停課的那一堂是**被補的一方**，所以它不出現這個選項。
      items.push({
        label: s.makeupFor ? '改指定補課' : '指定為補課',
        icon: 'pi pi-link',
        command: () => this.openMakeup(s),
      });
      items.push({ label: '停課', icon: 'pi pi-ban', command: () => this.openCancelDialog(s) });
    }
    if (s.status === 'cancelled') {
      items.push({
        label: '取消停課',
        icon: 'pi pi-replay',
        command: () => this.uncancelSingle(s),
      });
    }
    return items;
  });

  // ── 「全部異動」抽屜（#changes，A6） ─────────────────────────────────────
  /**
   * 開關**只由網址的 fragment 決定**（`#changes`）：分享連結、重新整理、返回鍵都自然成立，
   * 頁面自己不另存一份「開著沒」。從課表內點入口是 push 一筆歷史，所以返回鍵＝關閉；
   * 直接帶 hash 進來的沒有那一筆，關閉時改成原地把 hash 拿掉（不然「返回」會離開這一頁）。
   */
  protected readonly changesDrawerOpen = signal(false);
  private drawerPushed = false;
  private fragmentSeen = false;

  private watchChangesFragment(): void {
    this.route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
      const open = fragment === 'changes';
      // 第一次就已經是 #changes ＝直接帶 hash 進來；之後 false→true ＝使用者點了入口（push 了一筆）
      this.drawerPushed = open && this.fragmentSeen && !this.changesDrawerOpen();
      this.fragmentSeen = true;
      this.changesDrawerOpen.set(open);
    });
  }

  /** 抽屜自己關了（Esc、背景、×）：把網址的 hash 同步拿掉 */
  protected onChangesDrawerClosed(): void {
    if (!this.changesDrawerOpen()) return; // 返回鍵先把 hash 拿掉的那一路，不重複處理
    if (this.drawerPushed) {
      this.location.back();
    } else {
      void this.router.navigate([], {
        relativeTo: this.route,
        fragment: undefined,
        queryParamsHandling: 'preserve',
        replaceUrl: true,
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  constructor() {
    this.campusCtx.use();
    this.watchChangesFragment();
    // 第一次（ngOnInit 之後的第一輪變更偵測）就是初次載入；之後是頂欄換了分校
    let first = true;
    toObservable(this.campusCtx.id)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (first) {
          first = false;
          this.loadSessions();
          return;
        }
        this.onCampusChanged();
      });
  }

  ngOnInit(): void {
    this.applyIncomingAttendanceFilter();
    this.loadFilters();
    this.loadStudents();
  }

  // ── List actions ───────────────────────────────────────────────────────
  protected onSelectedIdsChange(ids: string[]): void {
    this.selectedIds.set(new Set(ids));
  }

  protected onMenuRequested(request: ScheduleMenuRequest): void {
    this.contextSession.set(request.session);
    this.sessionMenuRef()?.toggle(request.event);
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
    this.lastPicked = null;
    this.pickLabel.set('');
  }

  protected openOperationsLog(): void {
    this.dialogService.open(SessionOperationsLogDialogComponent, {
      width: '800px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
    });
  }

  // ── Batch dialog ───────────────────────────────────────────────────────
  protected openBatchSheet(initialMode: BatchMode | null = null): void {
    const data: MobileBatchDialogData = {
      sessionIds: [...this.selectedIds()],
      selectedCount: this.selectedCount(),
      teachers: this.batchAssignableTeachers(),
      hasCancelledSelection: this.hasCancelledSelection(),
      initialMode,
    };
    const ref = this.dialogService.open(MobileBatchDialogComponent, {
      header: `已選 ${this.selectedCount()} 堂`,
      width: '420px',
      closable: true,
      closeOnEscape: true,
      dismissableMask: true,
      appendTo: this.overlayContainer ?? 'body',
      data,
    });
    ref?.onClose.subscribe((result?: MobileBatchDialogResult) => {
      if (result?.action === 'applied') {
        this.clearSelection();
        this.loadSessions();
        const modeLabel: Record<string, string> = {
          cancel: '停課',
          uncancel: '取消停課',
          assign: '指派老師',
          time: '調整時間',
        };
        const label = modeLabel[result.mode] ?? '更新';
        const skipReasonMap: Record<string, string> = {
          cancel: '已停課的課堂無法重複操作',
          uncancel: '僅停課中的課堂可取消停課',
          assign: '已指派老師的課堂已略過',
          time: '已停課的課堂無法調整時間',
        };
        const skipReason = skipReasonMap[result.mode] ?? '條件不符';
        const detail =
          result.skipped > 0
            ? `已${label} ${result.updated} 堂，略過 ${result.skipped} 堂（${skipReason}）`
            : `已${label} ${result.updated} 堂`;
        this.messageService.add({ severity: 'success', summary: '批次操作完成', detail });
      }
    });
  }

  protected openAdvancedFiltersDialog(): void {
    if (this.isMobileViewport()) {
      this.openMobileFiltersDialog();
      return;
    }

    const ref = this.dialogService.open(SessionAdvancedFiltersDialogComponent, {
      header: '進階篩選',
      width: '36rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      appendTo: this.overlayContainer ?? 'body',
      data: {
        mode: 'sessions',
        campuses: this.campuses(),
        courses: this.courses(),
        classes: this.classes(),
        students: this.students(),
        teachers: this.activeTeachers(),
        selectedCampusIds: this.selectedCampusIds(),
        selectedCourseIds: this.selectedCourseIds(),
        selectedClassIds: this.selectedClassIds(),
        selectedStudentIds: this.selectedStudentIds(),
        selectedTeacherIds: this.selectedTeacherIds(),
        selectedStatuses: this.selectedStatuses(),
      },
    });

    ref?.onClose.subscribe((result?: SessionAdvancedFiltersDialogResult) => {
      if (!result) {
        return;
      }
      this.selectedCourseIds.set(result.courseIds);
      this.selectedTeacherIds.set(result.teacherIds);
      this.selectedClassIds.set(result.classIds);
      this.selectedStatuses.set(result.statuses);
      this.selectedStudentIds.set(result.studentIds);
      this.refreshStudentEnrolledClassIds(result.studentIds, () => this.loadSessions());
    });
  }

  private openMobileFiltersDialog(): void {
    const data: MobileFilterDialogData = {
      campuses: this.campuses(),
      courses: this.courses(),
      teachers: this.activeTeachers(),
      students: this.students(),
      sessions: this.sessions(),
      classes: this.classes(),
      selectedCampusIds: this.selectedCampusIds(),
      selectedCourseIds: this.selectedCourseIds(),
      selectedTeacherIds: this.selectedTeacherIds(),
      selectedClassIds: this.selectedClassIds(),
      selectedStudentIds: this.selectedStudentIds(),
      selectedStatuses: this.selectedStatuses(),
    };
    const ref = this.dialogService.open(MobileFilterDialogComponent, {
      header: '篩選條件',
      width: '420px',
      closable: true,
      closeOnEscape: true,
      dismissableMask: true,
      appendTo: this.overlayContainer ?? 'body',
      data,
    });
    ref?.onClose.subscribe((result?: MobileFilterDialogResult) => {
      if (result) {
        // 手機篩選對話框裡的分校也寫回頂欄那一份（只有一個來源）；重查由頂欄的訂閱做
        if ((result.campusIds[0] ?? null) !== this.campusCtx.id())
          this.campusCtx.select(result.campusIds[0] ?? null);
        this.selectedCourseIds.set(result.courseIds);
        this.selectedTeacherIds.set(result.teacherIds);
        this.selectedClassIds.set(result.classIds);
        this.selectedStudentIds.set(result.studentIds);
        this.selectedStatuses.set(result.statuses);
        this.refreshStudentEnrolledClassIds(result.studentIds, () => this.loadSessions());
      }
    });
  }

  // ── Single-session actions ─────────────────────────────────────────────
  protected openReschedule(session: Session): void {
    const ref = this.dialogService.open(SessionRescheduleDialogComponent, {
      header: '調課',
      width: '400px',
      data: { session },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  protected openSubstitute(session: Session): void {
    const ref = this.dialogService.open(SessionSubstituteDialogComponent, {
      header: '安排代課',
      width: '400px',
      data: { session },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  protected openCancelDialog(session: Session): void {
    const ref = this.dialogService.open(SessionCancelDialogComponent, {
      header: '停課',
      width: '400px',
      data: { session },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result?: { result: string } | string) => {
      const didRefresh =
        typeof result === 'string' ? result === 'refresh' : result?.result === 'refresh';
      if (didRefresh) {
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '已停課',
          // 用詞受 #592 裁定約束：只能說系統真的做得到的事。這個功能是
          // **指定既有課堂**，不是新增 —— 系統沒有 `POST /sessions`。
          detail: '要補這一堂，請到補課的那堂課上「指定為補課」',
          life: 6000,
        });
      }
    });
  }

  protected uncancelSingle(session: Session): void {
    this.sessionsActionsService.uncancelSingle(session.id).subscribe({
      next: () => {
        this.loadSessions();
        this.messageService.add({
          severity: 'success',
          summary: '已取消停課',
          detail: `${session.className} ${session.sessionDate}`,
        });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: '操作失敗', detail: '無法取消停課' });
      },
    });
  }

  protected openAssignSingle(session: Session): void {
    const eligibleTeachers = this.getEligibleTeachersForSession(session);
    const ref = this.dialogService.open(SessionAssignDialogComponent, {
      header: '指派老師',
      width: '400px',
      data: { session, ...(eligibleTeachers.length > 0 ? { teachers: eligibleTeachers } : {}) },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
    ref?.onClose.subscribe((result) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  // ── Filters ────────────────────────────────────────────────────────────
  /**
   * 頂欄換了分校：課程／班級／老師篩選裡**不屬於新分校的**拿掉（不是全清 ——
   * 手機篩選對話框可能同一次也選了新分校的課程），再重查。
   */
  private onCampusChanged(): void {
    const campus = this.campusCtx.id();
    if (campus) {
      const courses = new Set(
        this.courses()
          .filter((c) => c.campusId === campus)
          .map((c) => c.id),
      );
      const classes = new Set(
        this.classes()
          .filter((c) => c.campusId === campus)
          .map((c) => c.id),
      );
      const teachers = new Set(
        this.activeTeachers()
          .filter((t) => t.campusIds.includes(campus))
          .map((t) => t.id),
      );
      this.selectedCourseIds.update((ids) => ids.filter((id) => courses.has(id)));
      this.selectedClassIds.update((ids) => ids.filter((id) => classes.has(id)));
      this.selectedTeacherIds.update((ids) =>
        ids.filter((id) => id === '__unassigned__' || teachers.has(id)),
      );
    }
    this.refreshStudentEnrolledClassIds(this.selectedStudentIds(), () => this.loadSessions());
  }

  protected onCourseIdsChange(ids: string[]): void {
    this.selectedCourseIds.set(ids);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.loadSessions();
  }

  protected onTeacherIdsChange(ids: string[]): void {
    this.selectedTeacherIds.set(ids);
    this.loadSessions();
  }

  protected onClassChange(classIds: string[]): void {
    this.selectedClassIds.set(classIds);
    this.loadSessions();
  }

  protected onListDateRangeChange(range: Date[]): void {
    this.listDateRange.set(range);
    this.listDateRangeModified.set(true);
    if (range.length >= 1 && range[0]) {
      this.loadSessions();
    }
  }

  protected onStatusesChange(statuses: string[] | null): void {
    this.selectedStatuses.set(statuses ?? []);
    this.loadSessions();
  }

  protected onFilterUnassigned(): void {
    this.mode.set('results');
    this.clearSelection();
    const now = new Date();
    this.listDateRange.set([startOfMonth(now), endOfMonth(now)]);
    this.listDateRangeModified.set(false);
    this.selectedCourseIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.selectedStatuses.set(['scheduled']);
    this.selectedTeacherIds.set(['__unassigned__']);
    this.attendanceTakenFilter.set(undefined);
    this.endedOnlyFilter.set(false);
    this.loadSessions();
  }

  protected onFilterPendingAttendance(): void {
    this.mode.set('results');
    this.clearSelection();
    const today = new Date();
    this.listDateRange.set([today, today]);
    this.listDateRangeModified.set(true);
    this.selectedCourseIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedStatuses.set(['scheduled', 'completed']);
    // 現在真的篩得到了（#363）——badge 數字跟這裡套用的篩選同一個條件。
    this.attendanceTakenFilter.set(false);
    this.loadSessions();
  }

  /**
   * 從儀表板未點名卡連過來時套用的篩選（見 `sessions.util.ts` 的
   * `parseAttendanceQueryParams`）。查不到完整的三個欄位就什麼都不做——
   * 一般從選單點進這頁不會帶這些 query params，維持原本的預設篩選。
   */
  private applyIncomingAttendanceFilter(): void {
    const params = this.route.snapshot.queryParams;
    const fromClass = parseClassQueryParams(params);
    if (fromClass) {
      // 開課班的「看這班的課／看未指派的課」（courses.page）：整期範圍、指定班級
      this.mode.set('results');
      this.listDateRange.set([fromClass.from, fromClass.to].filter((d): d is Date => d !== null));
      this.selectedClassIds.set([fromClass.classId]);
      if (fromClass.courseId) this.selectedCourseIds.set([fromClass.courseId]);
      if (fromClass.unassigned) this.selectedTeacherIds.set(['__unassigned__']);
      return;
    }
    const incoming = parseAttendanceQueryParams(params);
    if (!incoming) return;

    this.mode.set('results');
    this.listDateRange.set([incoming.dateFrom, incoming.dateTo]);
    this.listDateRangeModified.set(true);
    this.attendanceTakenFilter.set(incoming.attendanceTaken);
    this.endedOnlyFilter.set(incoming.endedOnly);
    // 來源頁明著指定了課堂狀態就照它的，沒帶才留著本頁的 `DEFAULT_STATUSES`（#456）——
    // 兩份剛好相等的預設值會靜靜分歧，而「卡片 15、點進去 12」兩個數字都看起來合理
    if (incoming.statuses) this.selectedStatuses.set([...incoming.statuses]);
  }

  protected clearFilters(): void {
    this.selectedCourseIds.set([]);
    this.selectedTeacherIds.set([]);
    this.selectedClassIds.set([]);
    this.selectedStudentIds.set([]);
    this.studentEnrolledClassIds.set(new Set());
    this.studentFilteredEnrollments.set([]);
    this.selectedStatuses.set([...ALL_SESSION_STATUSES]);
    this.attendanceTakenFilter.set(undefined);
    this.endedOnlyFilter.set(false);
    this.loadSessions();
  }

  // ── 課表：換天、回到課表 ─────────────────────────────────────────────────
  protected readonly weekDays = computed(() => {
    const monday = startOfWeek(this.day(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  });

  /** 日期條點某天：週視圖時也切回那天的日視圖（A6：週視圖點一天＝看那天） */
  protected setDay(d: Date): void {
    if (this.mode() === 'day' && isSameDay(d, this.day())) return;
    this.mode.set('day');
    this.moveTo(d);
  }

  /** 換日／週、換天都**留著勾**（#1174 G3）：快速選取勾的是跨天的（某老師這週、某班整期），批次列會說有幾堂不在畫面上 */
  protected setView(view: 'day' | 'week'): void {
    if (this.mode() === view) return;
    this.mode.set(view);
    this.loadSessions();
  }

  /** 上一週／下一週／回到今天：留在目前的日／週檢視 */
  protected shiftWeek(weeks: number): void {
    this.moveTo(addDays(this.day(), weeks * 7));
  }

  protected goToday(): void {
    this.moveTo(new Date());
  }

  private moveTo(d: Date): void {
    this.day.set(startOfDay(d));
    this.loadSessions();
  }

  /** 「跳到某天」小日曆（原生 date input，`yyyy-MM-dd`） */
  protected jumpTo(value: string): void {
    if (value) this.setDay(parseISO(value));
  }

  /** 週視圖手機那一行（A6 `.wm__s`）：幾堂、最擠的時段、停課、其他異動 */
  protected weekRowSummary(d: WeekDaySummary): string {
    if (d.sessions.length === 0) return '沒有排課';
    const busiest = d.peak
      ? `${d.peak.from} 同時 ${d.peak.count} 班`
      : d.maxConcurrent
        ? '最多同時 1 班'
        : '整天停課';
    const other = d.changed - d.cancelled;
    return [
      `${d.sessions.length} 堂`,
      busiest,
      d.cancelled ? `停課 ${d.cancelled}` : '',
      other > 0 ? `${d.cancelled ? '其他' : ''}異動 ${other}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 日期條上被選中的那天（週視圖沒有「選中的天」） */
  protected isSelectedDay(d: Date): boolean {
    return this.mode() === 'day' && isSameDay(d, this.day());
  }

  /** 篩選結果 → 回到課表：放掉範圍條件，回到單日甘特 */
  protected backToSchedule(): void {
    this.mode.set('day');
    this.clearSelection();
    this.clearFilters();
  }

  /** 甘特預設顯示停課；這顆把停課收起來（收起後色面出現「已隱藏 N 堂停課 · 點此顯示」） */
  protected hideCancelled(): void {
    this.selectedStatuses.set([...DEFAULT_STATUSES]);
    this.loadSessions();
  }

  protected weekdayLabel(d: Date | string): string {
    return WEEKDAY[(typeof d === 'string' ? parseISO(d) : d).getDay()];
  }

  protected isTodayDate(d: Date): boolean {
    return isSameDay(d, this.now());
  }

  /** 狀態篩選目前有沒有包含停課（空陣列＝全部） */
  protected readonly showsCancelled = computed(() => {
    const st = this.selectedStatuses();
    return st.length === 0 || st.includes('cancelled');
  });

  // ── 勾課（#1174 G3）：單勾、Shift 範圍勾、快速選取 ────────────────────────────
  /** 上一次單堂勾的那堂（Shift 範圍勾的起點） */
  private lastPicked: string | null = null;
  /** 勾到的課怎麼來的（批次列的小字：「逐堂勾選」「林老師這週（今天起）」） */
  protected readonly pickLabel = signal('');
  /** 桌機快速選取列開著沒（手機是底部面板） */
  protected readonly picking = signal(false);
  protected readonly sheetOpen = signal(false);
  /** 畫面上由上而下的順序（甘特是老師列由上而下），Shift 範圍勾用 */
  private readonly pickOrder = computed(() => {
    const mode = this.mode();
    if (mode === 'day')
      return this.layout()?.rows.flatMap((r) => r.blocks.map((b) => b.session.id)) ?? [];
    const groups =
      mode === 'week'
        ? this.week().flatMap((d) => d.groups)
        : this.resultChapters().flatMap((c) => c.groups);
    return groups.flatMap((g) => g.sessions.map((s) => s.id));
  });
  /** 快速選取的兩個下拉：老師、班（跟著分校篩選） */
  protected readonly teacherPickOptions = computed(() =>
    this.activeTeachers().map((t) => ({ label: t.displayName, value: t.id })),
  );
  protected readonly classPickOptions = computed(() => {
    const campus = new Set(this.selectedCampusIds());
    return this.classes()
      .filter((c) => campus.size === 0 || campus.has(c.campusId))
      .map((c) => ({ label: c.name, value: c.id }));
  });
  /** 勾到的課裡，現在畫面上看得到幾堂 */
  protected readonly visibleSelectedCount = computed(() => {
    const ids = this.selectedIds();
    return this.displayedSessions().filter((s) => ids.has(s.id)).length;
  });

  protected toggleSelect(req: SchedulePickRequest): void {
    for (const s of this.displayedSessions()) this.known.set(s.id, s);
    const last = req.shiftKey ? this.lastPicked : null;
    this.selectedIds.set(pickRange(this.selectedIds(), this.pickOrder(), last, req.id));
    this.lastPicked = req.id;
    this.pickLabel.set('逐堂勾選');
  }

  protected readonly dayIso = computed(() => format(this.day(), 'yyyy-MM-dd'));
  /** 手機面板列哪些課：跟著目前的檢視（日＝那天、週＝有課的每一天、篩選結果＝依日期分章） */
  protected readonly sheetChapters = computed(() => {
    const mode = this.mode();
    if (mode === 'day') return [{ date: this.dayIso(), groups: this.dayGroups() }];
    if (mode === 'week')
      return this.week()
        .filter((d) => d.groups.length)
        .map((d) => ({ date: d.date, groups: d.groups }));
    return this.resultChapters();
  });

  /** 面板的動作鈕：先收起面板（原生 modal 在 top layer，會蓋住批次對話框）再開 */
  protected onSheetAct(mode: BatchMode | null): void {
    this.sheetOpen.set(false);
    this.openBatchSheet(mode);
  }

  /** 手機長按一堂：勾起它、打開快速選取面板（A6） */
  protected onLongPress(id: string): void {
    if (!this.selectedIds().has(id)) this.toggleSelect({ id, shiftKey: false });
    this.sheetOpen.set(true);
  }

  private pickAll(sessions: readonly Session[], label: string): void {
    for (const s of sessions) this.known.set(s.id, s);
    this.selectedIds.set(new Set(sessions.map((s) => s.id)));
    this.lastPicked = null;
    this.pickLabel.set(label);
  }

  /** 這一整天（`yyyy-MM-dd`；週視圖每欄一顆） */
  protected pickDay(date: string): void {
    const name =
      date === format(this.now(), 'yyyy-MM-dd')
        ? '今天'
        : `週${this.weekdayLabel(date)} ${format(parseISO(date), 'M/d')}`;
    this.pickAll(
      this.displayedSessions().filter((s) => s.sessionDate === date),
      `${name}整天`,
    );
  }

  /** 某位老師這週的課（今天起、不含停課，A6 `selectTeacher`） */
  protected pickTeacher(teacherId: string): void {
    const sunday = this.weekDays()[6];
    const from = [this.weekDays()[0], startOfDay(this.now())].reduce((a, b) => (a > b ? a : b));
    const name = this.staff().find((t) => t.id === teacherId)?.displayName ?? '這位老師';
    if (from > sunday) return this.pickAll([], `${name}這週（今天起）`);
    this.fetchPicks(
      {
        teacherIds: [teacherId],
        from: format(from, 'yyyy-MM-dd'),
        to: format(sunday, 'yyyy-MM-dd'),
      },
      `${name}這週（今天起）`,
    );
  }

  /** 某個班整期的課（今天起、不含停課，A6 `selectClass`） */
  protected pickClass(classId: string): void {
    const name = this.classes().find((c) => c.id === classId)?.name ?? '這個班';
    this.fetchPicks(
      { classIds: [classId], from: format(this.now(), 'yyyy-MM-dd') },
      `${name}整期（今天起）`,
    );
  }

  private fetchPicks(params: SessionQueryParams, label: string): void {
    this.sessionsService
      .list({
        ...params,
        // 跟畫面同一個分校篩選：勾到的課要是這一頁看得到的那一間
        campusIds: this.selectedCampusIds().length > 0 ? this.selectedCampusIds() : undefined,
        statuses: ['scheduled'],
        page: 1,
        pageSize: FETCH_LIMIT,
      })
      .subscribe({
        next: (res) => this.pickAll(res.data, label),
        error: () =>
          this.messageService.add({
            severity: 'error',
            summary: '沒有勾到課',
            detail: '可能是連線問題，再試一次',
          }),
      });
  }

  // ── Detail popup ───────────────────────────────────────────────────────
  protected openDetail(session: Session): void {
    this.dialogService.open(SessionDetailDialogComponent, {
      // 這支的 header **會渲染**（沒有 showHeader: false），內容區原本又有一行
      // 「課堂異動紀錄」的 eyebrow，兩個標題疊在一起。留比較精確的那個講法，
      // 並且刻意**不**跟頁面層那顆「操作紀錄」按鈕同名 —— 那顆開的是全部課堂的
      // 操作紀錄，這個只有這一堂，同名會把有意義的差異抹平（#448）
      header: '課堂異動紀錄',
      width: '400px',
      data: { session, loadingChanges: true, changes: [] },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });
  }

  /**
   * 指定這堂課補的是哪一堂停課。可補清單由端點提供，**前端不再過濾一次** ——
   * 排除條件的載體越多越會漂移（見 `sessions.service.ts` 的 `MakeupCandidate`）。
   */
  protected openMakeup(session: Session): void {
    const ref = this.dialogService.open(SessionMakeupDialogComponent, {
      header: '指定補課',
      width: '420px',
      modal: true,
      appendTo: this.overlayContainer ?? 'body',
      data: { session },
    });
    ref?.onClose.subscribe((result?: string) => {
      if (result === 'refresh') this.loadSessions();
    });
  }

  protected openAttendance(session: Session): void {
    // 停課沒有出勤事件（選單已 disable）；這裡是防線，不讓對話框拿到空的 eventId
    if (!session.eventId) {
      this.messageService.add({
        severity: 'warn',
        summary: '無法開啟點名',
        detail: '這堂課沒有出勤事件，請重新整理後再試。',
      });
      return;
    }

    const ref = this.dialogService.open(AttendanceRosterPanelComponent, {
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      data: {
        eventId: session.eventId,
        className: session.className,
        eventDate: session.sessionDate,
        timeRange: `${session.startTime}–${session.endTime}`,
      },
      styleClass: 'session-dialog',
      appendTo: this.overlayContainer ?? 'body',
    });

    ref?.onClose.subscribe((result?: AttendanceDialogCloseResult) => {
      if (!result) {
        return;
      }

      this.sessions.update((sessions) =>
        sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                attendanceTakenAt: result.takenAt,
                attendancePresentCount: result.presentCount,
                attendanceAbsentCount: result.absentCount,
                attendanceOnLeaveCount: result.onLeaveCount,
              }
            : item,
        ),
      );
    });
  }

  // ── Private ────────────────────────────────────────────────────────────
  /** 頁首那顆「已隱藏 N 堂停課」被按下 —— 把已停課加回狀態篩選 */
  protected onRevealCancelled(): void {
    if (this.selectedStatuses().includes('cancelled')) return;
    this.selectedStatuses.set([...this.selectedStatuses(), 'cancelled']);
    this.loadSessions();
  }

  private isDefaultStatuses(): boolean {
    const current = [...this.selectedStatuses()].sort().join(',');
    const def = [...ALL_SESSION_STATUSES].sort().join(',');
    return current === def;
  }

  private isMobileViewport(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    return window.innerWidth <= 768;
  }

  private getEligibleTeachersForSession(session: Session): Staff[] {
    const campusTeachers = this.activeTeachers().filter((t) =>
      t.campusIds.includes(session.campusId),
    );
    const course = this.courses().find((c) => c.id === session.courseId);
    if (!course) return campusTeachers;
    return campusTeachers.filter((t) => t.subjectIds.includes(course.subjectId));
  }

  private loadFilters(): void {
    this.refData.loadCampuses();
    this.refData.loadTeachers();
    this.coursesService.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) => this.courses.set(res.data),
    });
    this.classesService.list({ isActive: true, pageSize: 0 }).subscribe({
      next: (res) =>
        this.classes.set(
          res.data.map((c) => ({
            id: c.id,
            name: c.name,
            courseId: c.courseId,
            campusId: c.campusId,
          })),
        ),
    });
  }

  private loadStudents(): void {
    this.studentsService.list({ isActive: true, page: 1, pageSize: 100 }).subscribe({
      next: (firstPage) => {
        const totalPages = firstPage.meta.totalPages ?? 1;
        if (totalPages <= 1) {
          this.students.set(firstPage.data);
          return;
        }

        forkJoin(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            this.studentsService.list({
              isActive: true,
              page: index + 2,
              pageSize: 100,
            }),
          ),
        ).subscribe({
          next: (otherPages) => {
            this.students.set([firstPage.data, ...otherPages.map((page) => page.data)].flat());
          },
          error: () => {
            this.students.set(firstPage.data);
          },
        });
      },
      error: () => {
        this.students.set([]);
      },
    });
  }

  protected loadSessions(): void {
    const mode = this.mode();
    const range =
      mode === 'day'
        ? [this.day(), this.day()]
        : mode === 'week'
          ? [this.weekDays()[0], this.weekDays()[6]]
          : this.listDateRange();
    this.now.set(new Date());
    const rawIds = this.selectedTeacherIds();
    const realTeacherIds = rawIds.filter((id) => id !== '__unassigned__');
    const hasUnassigned = rawIds.includes('__unassigned__');
    const dateFrom = range[0] ? format(range[0], 'yyyy-MM-dd') : undefined;
    const dateTo = range[1]
      ? format(range[1], 'yyyy-MM-dd')
      : range[0]
        ? format(range[0], 'yyyy-MM-dd')
        : undefined;

    // When student filter is active, restrict API query to that student's enrolled classes.
    // Without this, pagination means only a fraction of matching sessions would be visible.
    let effectiveClassIds: string[] | undefined;
    if (this.selectedStudentIds().length > 0) {
      const studentClassIds = [...this.studentEnrolledClassIds()];
      if (studentClassIds.length === 0) {
        // Student has no matching enrollments — nothing to show
        this.sessions.set([]);
        this.totalSessions.set(0);
        this.loading.set(false);
        return;
      }
      const explicitClassIds = this.selectedClassIds();
      if (explicitClassIds.length > 0) {
        const studentSet = new Set(studentClassIds);
        effectiveClassIds = explicitClassIds.filter((id) => studentSet.has(id));
        if (effectiveClassIds.length === 0) {
          this.sessions.set([]);
          this.totalSessions.set(0);
          this.loading.set(false);
          return;
        }
      } else {
        effectiveClassIds = studentClassIds;
      }
    } else {
      effectiveClassIds = this.selectedClassIds().length > 0 ? this.selectedClassIds() : undefined;
    }

    const listParams: SessionQueryParams = {
      from: dateFrom,
      to: dateTo,
      campusIds: this.selectedCampusIds().length > 0 ? this.selectedCampusIds() : undefined,
      courseIds: this.selectedCourseIds().length > 0 ? this.selectedCourseIds() : undefined,
      teacherIds: realTeacherIds.length > 0 ? realTeacherIds : undefined,
      classIds: effectiveClassIds,
      assignmentStatus: hasUnassigned ? 'unassigned' : undefined,
      attendanceTaken: this.attendanceTakenFilter(),
      endedOnly: this.endedOnlyFilter(),
      statuses: this.selectedStatuses().length > 0 ? this.selectedStatuses() : undefined,
      page: 1,
      pageSize: FETCH_LIMIT,
    };

    this.loading.set(true);
    this.loadFailed.set(false);
    // 一支請求拿齊（#950）：出勤摘要、eventId、被狀態篩選藏起來的停課數（#640）
    // 都跟著 `/api/sessions` 回來。原本是 sessions → attendance/sessions →
    // sessions?statuses=cancelled 三段依序請求。
    this.sessionsService.list(listParams).subscribe({
      next: (res) => {
        this.sessions.set(res.data);
        this.totalSessions.set(res.meta.total);
        this.monthUnassignedCount.set(res.meta.monthUnassignedCount);
        this.todayPendingAttendanceCount.set(res.meta.todayPendingAttendanceCount);
        this.hiddenCancelledCount.set(res.meta.hiddenCancelledCount);
        this.loading.set(false);
        this.loadedOnce.set(true);
      },
      error: () => {
        this.loading.set(false);
        // **不再發 toast** —— 主體現在有常駐的失敗狀態（照 /admin/payments，#788）
        this.loadFailed.set(true);
      },
    });
  }

  private refreshStudentEnrolledClassIds(studentIds: string[], onComplete?: () => void): void {
    if (studentIds.length === 0) {
      this.studentEnrolledClassIds.set(new Set());
      this.studentFilteredEnrollments.set([]);
      onComplete?.();
      return;
    }

    forkJoin(studentIds.map((studentId) => this.loadAllStudentEnrollments(studentId))).subscribe({
      next: (results) => {
        const enrollments = results
          .flat()
          .filter((item) => isAttendanceStudentEnrollmentStatus(item.status));
        const campusIds = this.selectedCampusIds();
        const classIds = new Set(
          enrollments
            .filter(
              (item) =>
                campusIds.length === 0 || !item.campusId || campusIds.includes(item.campusId),
            )
            .map((item) => item.classId),
        );
        this.studentFilteredEnrollments.set(enrollments);
        this.studentEnrolledClassIds.set(classIds);
        onComplete?.();
      },
      error: () => {
        this.studentFilteredEnrollments.set([]);
        this.studentEnrolledClassIds.set(new Set());
        onComplete?.();
      },
    });
  }

  private loadAllStudentEnrollments(studentId: string) {
    return this.enrollmentsService.list({ studentId, page: 1, pageSize: 100 }).pipe(
      switchMap((firstPage) => {
        const totalPages = firstPage.meta.totalPages ?? 1;
        if (totalPages <= 1) {
          return of(firstPage.data);
        }

        return forkJoin(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            this.enrollmentsService.list({
              studentId,
              page: index + 2,
              pageSize: 100,
            }),
          ),
        ).pipe(
          map((otherPages) => [firstPage.data, ...otherPages.map((page) => page.data)].flat()),
          catchError(() => of(firstPage.data)),
        );
      }),
    );
  }

  private hasMatchingStudentEnrollment(
    session: Session,
    enrollments: ReadonlyArray<Enrollment>,
  ): boolean {
    return enrollments.some((enrollment) => {
      if (enrollment.classId !== session.classId) {
        return false;
      }

      if (enrollment.campusId && enrollment.campusId !== session.campusId) {
        return false;
      }

      return isDateWithinRange(
        session.sessionDate,
        enrollment.effectiveFrom,
        enrollment.effectiveTo,
      );
    });
  }
}

function isDateWithinRange(date: string, start: string, end: string | null): boolean {
  return date >= start && (end === null || date <= end);
}

function isAttendanceStudentEnrollmentStatus(status: Enrollment['status']): boolean {
  return status === 'active' || status === 'suspended' || status === 'withdrawal';
}
