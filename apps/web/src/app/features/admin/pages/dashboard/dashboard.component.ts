import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { catchError, forkJoin, of, type Observable } from 'rxjs';

import { AcademyExamsService } from '@core/academy-exams.service';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { DayTimelineComponent } from '@shared/components/day-timeline/day-timeline.component';
import { AuthService } from '@core/auth.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import type { AttendanceMode } from '@core/org-settings.service';
import { SchoolExamsService } from '@core/school-exams.service';
import { StudentsService } from '@core/students.service';
import { RoutesCatalog, type RouteObj } from '@core/smart-enums/routes-catalog';

import { CollapsibleComponent } from '@shared/components/collapsible/collapsible.component';

import { pendingAttendanceQuery } from './dashboard.util';
import {
  StatusDotComponent,
  type StatusTone,
} from '@shared/components/status/status-dot/status-dot.component';
import { attendanceTone as toAttendanceTone } from '@shared/utils/attendance-tone.util';

/** `null` 是還在載入，`'error'` 是這張卡自己的查詢掛了 */
type CardValue = number | 'error' | null;

interface StatCard {
  readonly label: string;
  readonly value: CardValue;
  readonly sub?: string;
  readonly icon: string;
  readonly routerLink: string;
  /**
   * 帶去目的頁的篩選——**沒有這個欄位，卡片的數字跟落地頁篩選後看到的東西
   * 永遠是兩件事**（P1-6：kb/wiki/architecture/admin-todo-alerts.md）。
   * 沒有篩選需求的卡片就不填，模板綁 `card.queryParams ?? {}`。
   */
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly accent?: boolean;
  /**
   * 這張卡是「今天要動作的事」還是「背景脈絡」。
   *
   * 舊版六張卡等權排成一列，所以「未點名 6」跟「在籍學生 27」長得一樣大 ——
   * 但一個要動作、一個只是背景。分類讓構圖能把它們放到不同的地方：
   * `todo` 進待處理區、其餘退到右側安靜的現況欄。
   */
  readonly kind: 'todo' | 'fact';
}

/**
 * 使用者手動收合橘帶時間軸的偏好。
 *
 * **原本還有一條自動收合**（lane 超過 3 條就預設收起來），依據是實測：橘帶在
 * 1 堂課時 226px、4 條 lane 時 359px（48% 視窗），整頁 1.76 螢幕、課表整段掉到
 * 摺線下。那是 lane 式畫法的止血。
 *
 * 時間軸換成密度圖之後**高度與課量脫鉤**，那個依據不存在了，所以自動收合退役 ——
 * 留著只是把資訊藏起來。這個鍵保留，因為使用者按過的選擇要繼續生效。
 */
const TIMELINE_COLLAPSED_KEY = 'clessia.dashboard.timeline-collapsed';

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

const FAILED = 'error' as const;

/** 一張卡的查詢掛掉不該讓整頁空白，所以每支查詢各自把錯誤吞成 `'error'` */
function failSoft<T>(source: Observable<T>): Observable<T | typeof FAILED> {
  return source.pipe(catchError(() => of(FAILED)));
}

function readStoredCollapsed(): boolean | null {
  try {
    const v = localStorage.getItem('clessia.dashboard.timeline-collapsed');
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function countOf(items: readonly unknown[] | 'error' | null): CardValue {
  return items === null || items === FAILED ? items : items.length;
}

/** 回溯窗：昨天忘記點的今天要追得到，更久以前的漏點名是報表該查的異常 */
const UNTAKEN_LOOKBACK_DAYS = 7;

import {
  WorkbenchService,
  type WorkbenchExpectedStudent,
  type WorkbenchToday,
} from '@core/workbench.service';
import { DailyCheckinsService } from '@core/daily-checkins.service';
@Component({
  selector: 'app-dashboard',
  imports: [StatusDotComponent, RouterLink, DayTimelineComponent, CollapsibleComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly leaveService = inject(LeaveService);
  private readonly academyExamsService = inject(AcademyExamsService);
  private readonly schoolExamsService = inject(SchoolExamsService);
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly workbenchService = inject(WorkbenchService);
  private readonly dailyCheckinsService = inject(DailyCheckinsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly now = new Date();
  private readonly todayIso = format(this.now, 'yyyy-MM-dd');

  protected readonly today = this.now;
  /** 時間軸要的是本地日期字串。用 date-fns 的 format 而不是 toISOString ——
      補習班的「今天」是本地的今天，UTC+8 的凌晨會差一天（既有 spec 踩過）。 */
  protected readonly todayKey = format(this.now, 'yyyy-MM-dd');

  /**
   * 時間軸收合狀態。
   *
   * 收的是**時間軸**不是整條帶 —— 帶上那句話（「今天 9 堂課，其中 6 堂還沒點名」）
   * 是這一頁的錨點，收掉它等於收掉重點。隨密度長大的是時間軸（359px 裡的 136px）。
   *
   * `null` = 使用者還沒表態，這時候看 lane 數決定；一旦他按過就永遠照他的意思。
   */
  private readonly storedCollapsed = signal<boolean | null>(readStoredCollapsed());

  /**
   * **自動收合退役了。** 它的依據是「lane 超過 3 條時圖會長到把課表推到摺線下」，
   * 而時間軸改成密度圖之後**高度與課量脫鉤** —— 那個依據不存在了，
   * 再自動收就只是把資訊藏起來。
   *
   * 手動收合保留（可收合帶是已裁的方向），使用者按過就照他的意思。
   */
  protected readonly timelineCollapsed = computed(() => this.storedCollapsed() ?? false);

  /** 有課才顯示收合鈕 —— 沒課的日子那條軸本來就不畫，給一顆收合鈕是空的動作 */
  protected readonly hasTimeline = computed(() => (this.todaySessionList()?.length ?? 0) > 0);

  /**
   * 就地點名：從這裡直接開點名 dialog，不用「儀表板 → 課堂管理 → 找到那一堂」。
   *
   * **`DialogService` 與面板都是 `await import(...)`。** 靜態 import 會把整棵
   * PrimeNG dialog 依賴樹拉進儀表板的 chunk —— 而儀表板是進站第一頁。
   * 見 `kb/wiki/lessons/root-component-pins-the-bundle.md` 與
   * `lessons/lazy-chunk-is-not-lazy-if-statically-required.md`。
   */
  private readonly envInjector = inject(EnvironmentInjector);
  private destroyed = false;

  /**
   * 這堂課現在點得了名嗎。
   *
   * - **日到班模式一律不行** —— 那個模式沒有逐堂出勤這回事（到班看板是另一刀）
   * - 停課的課堂沒有 `eventId`，沒有可點名的載體
   */
  protected canTakeAttendance(session: EventSessionSummary): boolean {
    return this.attendanceMode() === 'per_session' && session.eventId !== null;
  }

  protected async openAttendance(session: EventSessionSummary): Promise<void> {
    if (!this.canTakeAttendance(session) || session.eventId === null) return;

    const [{ DialogService }, { AttendanceRosterPanelComponent }] = await Promise.all([
      import('primeng/dynamicdialog'),
      import('@shared/components/attendance-roster-panel/attendance-roster-panel.component'),
    ]);

    // import 是非同步的，這中間使用者可能已經離開這一頁 —— 元件死了就別再開窗，
    // 否則會留下一個沒有主人的彈窗（NG0911）。
    if (this.destroyed) return;

    const injector = createEnvironmentInjector([DialogService], this.envInjector);
    this.destroyRef.onDestroy(() => injector.destroy());

    const ref = injector.get(DialogService).open(AttendanceRosterPanelComponent, {
      header: '管理出勤狀況',
      width: '480px',
      closable: true,
      // 憲法 c6：不用 vw
      breakpoints: { '640px': '92%' },
      data: {
        eventId: session.eventId,
        className: session.className,
        eventDate: session.eventDate,
        timeRange:
          session.startTime && session.endTime
            ? `${session.startTime}–${session.endTime}`
            : undefined,
      },
      styleClass: 'session-dialog',
    });

    // open() 在沒有 document 的環境回 null
    ref?.onClose.subscribe((result?: { takenAt: string }) => {
      if (!result) return;
      // **就地更新，不重打 API。** 這一列的狀態剛剛才由 dialog 寫進去，
      // 再查一次只是把同一件事問兩遍，而且會讓那一列閃一下。
      this.todaySessions.update((sessions) =>
        sessions === null || sessions === FAILED
          ? sessions
          : sessions.map((item) =>
              item.sessionId === session.sessionId ? { ...item, takenAt: result.takenAt } : item,
            ),
      );
    });

    // 離開這條路由時彈窗要跟著消失。用 destroy() 不是 close() ——
    // close() 會走 onClose，那條路的意思是「使用者存了檔」。
    this.destroyRef.onDestroy(() => ref?.destroy());
  }

  // ── 日到班看板 ────────────────────────────────────────────────────────
  //
  // **晨間視角是「誰還沒到」，不是「誰到了」。** 一張列出全部學生的表，行政要自己
  // 掃描找出缺口；而晨間真正的工作是**追還沒到的人**（打電話問家長、確認是不是請假）。
  //
  // 三段的順序就是它們的重要性：還沒到（工作）→ 已請假（別打那通電話）→ 已到（確認）。

  protected readonly isDailyCheckin = computed(() => this.attendanceMode() === 'daily_checkin');

  private readonly arrivedById = computed(
    () => new Map((this.workbench()?.arrived ?? []).map((a) => [a.studentId, a])),
  );

  /**
   * 已請假的學生。**這是第三種狀態，不是「還沒到」的一種** ——
   * 混在一起行政會去打一通不必要的電話。
   */
  protected readonly leaveList = computed(() => this.workbench()?.onLeave ?? []);

  private readonly onLeaveIds = computed(
    () => new Set(this.leaveList().map((leave) => leave.studentId)),
  );

  /**
   * 還沒到 = 應到 − 已到 − 已請假，**依分校分組**。
   *
   * 分組而不是「先選分校再看」（使用者裁定）：分組在分校隔離落地前後都成立 ——
   * 現在管理者看到全部分校各自的缺口，有隔離之後他只會拿到自己那組，同一段 UI
   * 不用改。單一分校的機構不顯示分組標題。
   */
  protected readonly notArrivedGroups = computed(() => {
    const arrived = this.arrivedById();
    const onLeave = this.onLeaveIds();
    const pending = (this.workbench()?.expected ?? []).filter(
      (student) => !arrived.has(student.studentId) && !onLeave.has(student.studentId),
    );

    const groups = new Map<string, { campusName: string; students: typeof pending }>();
    for (const student of pending) {
      const key = student.campusId ?? '';
      const group = groups.get(key) ?? {
        campusName: student.campusName ?? '未指定分校',
        students: [],
      };
      group.students.push(student);
      groups.set(key, group);
    }

    return [...groups.values()];
  });

  protected readonly notArrivedCount = computed(() =>
    this.notArrivedGroups().reduce((sum, group) => sum + group.students.length, 0),
  );

  /** 已到：把打卡時間接回名字。應到名單是唯一有名字的來源。 */
  protected readonly arrivedList = computed(() => {
    const names = new Map(
      (this.workbench()?.expected ?? []).map((s) => [s.studentId, s.studentName]),
    );
    return (this.workbench()?.arrived ?? []).map((arrival) => ({
      ...arrival,
      studentName: names.get(arrival.studentId) ?? '（不在今天的名單上）',
    }));
  });

  protected readonly boardBusy = signal<string | null>(null);

  /** 「已到」預設收合 —— 它是確認不是工作。這裡不記 localStorage：跨天沒有意義。 */
  protected readonly arrivedCollapsed = signal(true);

  protected toggleArrived(): void {
    this.arrivedCollapsed.update((collapsed) => !collapsed);
  }

  /** `HH:mm`。打卡時間是 ISO 字串，而行政要看的是「幾點到的」。 */
  protected arrivalClock(isoTime: string): string {
    const at = new Date(isoTime);
    return Number.isNaN(at.getTime())
      ? '—'
      : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * 勾到班。
   *
   * **勾完只顯示「已到班 09:12」，不顯示「已為 N 堂課記錄出席」** —— 後者取決於
   * API 那邊的散播規則（`#178`：只寫他有報名的課），是機器的推論而不是觀察到的
   * 事實。把推論寫成事實，之後規則一改那句話就變成謊。
   */
  protected checkIn(student: WorkbenchExpectedStudent): void {
    if (this.boardBusy() !== null) return;
    this.boardBusy.set(student.studentId);

    this.dailyCheckinsService
      .checkIn({
        studentId: student.studentId,
        checkinDate: this.todayIso,
        campusId: student.campusId ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (checkin) => {
          // 用回應而不是樂觀更新 —— 到班時間是伺服器給的，猜一個會跟事實差幾秒
          this.workbench.update((current) =>
            current === null
              ? current
              : {
                  ...current,
                  arrived: [
                    ...current.arrived,
                    {
                      studentId: checkin.studentId,
                      checkedInAt: checkin.checkedInAt,
                      checkinId: checkin.id,
                    },
                  ],
                },
          );
          this.boardBusy.set(null);
        },
        error: () => this.boardBusy.set(null),
      });
  }

  /** 勾錯了。取消會連同它寫出來的出勤紀錄一起刪（不是改成缺席）。 */
  protected cancelArrival(checkinId: string): void {
    if (this.boardBusy() !== null) return;
    this.boardBusy.set(checkinId);

    this.dailyCheckinsService
      .cancel(checkinId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.workbench.update((current) =>
            current === null
              ? current
              : { ...current, arrived: current.arrived.filter((a) => a.checkinId !== checkinId) },
          );
          this.boardBusy.set(null);
        },
        error: () => this.boardBusy.set(null),
      });
  }

  protected toggleTimeline(): void {
    const next = !this.timelineCollapsed();
    this.storedCollapsed.set(next);
    try {
      localStorage.setItem(TIMELINE_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // 無痕視窗之類的環境沒有 localStorage —— 記不住不是錯誤，這一次仍然生效
    }
  }

  /**
   * 橘帶上的日期。**在這裡算而不是用 DatePipe 帶 locale** ——
   * `registerLocaleData(localeZhTW)` 是在 `app.config.ts` 跑的，TestBed 不載它，
   * 所以 `date: … : 'zh-TW'` 在測試環境會炸「Missing locale data」。
   * 星期用自己的陣列，不依賴任何 locale 註冊。
   */
  protected readonly todayLabel = `${format(this.now, 'yyyy 年 M 月 d 日')} · ${WEEKDAYS[this.now.getDay()]}`;

  private readonly todaySessions = signal<EventSessionSummary[] | 'error' | null>(null);
  /**
   * 未點名堂數，**整個來自伺服器**（`endedOnly` 到位後不再拆兩段查、
   * 前端也不再算一次——同一個數字算兩次是這張卡先前對不上落地頁的根因）。
   */
  private readonly untakenCount = signal<CardValue>(null);
  private readonly todayLeaves = signal<LeaveRequest[] | 'error' | null>(null);
  private readonly gradesTodo = signal<CardValue>(null);
  private readonly activeStudents = signal<CardValue>(null);
  private readonly enrollmentChanges = signal<CardValue>(null);
  /** `null` 代表讀不到機構設定 */
  private readonly attendanceMode = signal<AttendanceMode | null>(null);
  /** 日到班看板要用的那三段（應到／已到／請假）。逐堂模式下它們是空陣列。 */
  private readonly workbench = signal<WorkbenchToday | null>(null);

  /**
   * **`null` 是「還不知道」，不是「沒有」。**
   *
   * 這裡原本在載入中回空陣列，於是模板會宣稱「今日尚無排課」—— 一個當下還
   * 不知道的事實。#110 在模板層擋住了這張卡，但型別不擋的話下一張卡照樣會
   * 重蹈覆轍。回傳 `T[] | null` 之後，模板不先分辨載入中就過不了型別檢查。
   */
  protected readonly todaySessionList = computed<EventSessionSummary[] | null>(() => {
    const sessions = this.todaySessions();
    if (sessions === null) return null;
    if (sessions === FAILED) return [];

    return [...sessions].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  });

  /** 同上：`null` 是還不知道 */
  protected readonly todayLeaveList = computed<LeaveRequest[] | null>(() => {
    const leaves = this.todayLeaves();
    if (leaves === null) return null;
    return leaves === FAILED ? [] : leaves;
  });

  protected readonly sessionsFailed = computed(() => this.todaySessions() === FAILED);
  protected readonly leavesFailed = computed(() => this.todayLeaves() === FAILED);

  /**
   * `'hidden'` 是整張卡不該存在：`daily-checkins` 建立 attendance_records 但從不蓋
   * `events.attendance_taken_at`，日到班模式下每一堂都會被算成漏點名。讀不到機構設定時
   * 同樣不顯示 —— 無從判斷這個數字有沒有意義，寧可少一張卡也不要給一個可能全錯的數。
   */
  private readonly untaken = computed<CardValue | 'hidden'>(() => {
    const mode = this.attendanceMode();
    if (mode !== 'per_session') return 'hidden';

    return this.untakenCount();
  });

  /**
   * 未點名卡的篩選——唯一來源是 `pendingAttendanceQuery`，儀表板算數字跟
   * 卡片的 `queryParams` 都從它產生，兩者不能各自拼一份。
   */
  private readonly untakenQuery = computed(() =>
    pendingAttendanceQuery(this.now, UNTAKEN_LOOKBACK_DAYS),
  );

  protected readonly cards = computed<StatCard[]>(() => {
    const cards: StatCard[] = [
      {
        kind: 'fact',
        label: '今日課堂',
        value: countOf(this.todaySessions()),
        icon: 'pi-calendar',
        routerLink: RoutesCatalog.ADMIN_SESSIONS.absolutePath,
      },
    ];

    const untaken = this.untaken();
    if (untaken !== 'hidden') {
      const query = this.untakenQuery();
      cards.push({
        kind: 'todo',
        label: '未點名課堂',
        value: untaken,
        sub: `近 ${UNTAKEN_LOOKBACK_DAYS} 天`,
        icon: 'pi-exclamation-triangle',
        routerLink: RoutesCatalog.ADMIN_ATTENDANCE.absolutePath,
        // ⚠️ 落地頁（sessions.page.ts）目前只接得住 attendanceTaken——
        // GET /api/sessions 還沒有 endedOnly（billing-api 待補，見 PR 說明）。
        // 這裡照樣把完整語意帶過去，缺口補上那天不用回頭改這裡。
        queryParams: {
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          attendanceTaken: String(query.attendanceTaken),
          endedOnly: String(query.endedOnly),
        },
        accent: true,
      });
    }

    cards.push(
      {
        kind: 'fact',
        label: '今日請假',
        value: countOf(this.todayLeaves()),
        icon: 'pi-file',
        routerLink: RoutesCatalog.ADMIN_LEAVE.absolutePath,
      },
      {
        kind: 'todo',
        label: '成績待登錄',
        value: this.gradesTodo(),
        sub: '校內考 + 段考',
        icon: 'pi-pencil',
        routerLink: RoutesCatalog.ADMIN_GRADES_EXAMS.absolutePath,
      },
    );

    if (this.auth.hasPermission('view_reports')) {
      cards.push(
        {
          kind: 'fact',
          label: '在籍學生',
          value: this.activeStudents(),
          icon: 'pi-users',
          routerLink: RoutesCatalog.ADMIN_STUDENTS.absolutePath,
        },
        {
          kind: 'fact',
          label: '本月報名異動',
          value: this.enrollmentChanges(),
          // meta.total 數的是「期間內有異動的報名記錄」，一筆當月插班又退班的報名在這裡是 1，
          // 在總覽頁的事件分類裡會是 joined + left 兩筆 —— 所以單位是「筆」，分項去那邊看
          sub: '筆 · 點擊查看進出分項',
          icon: 'pi-sign-in',
          routerLink: RoutesCatalog.ADMIN_ENROLLMENTS.absolutePath,
        },
      );
    }

    return cards;
  });

  /** 待處理：只有真的要動作的才進來 */
  protected readonly todoCards = computed(() => this.cards().filter((c) => c.kind === 'todo'));

  /** 現況：背景脈絡，放右側安靜的窄欄 */
  protected readonly factCards = computed(() => this.cards().filter((c) => c.kind === 'fact'));

  /**
   * 橘帶上那句話。**它算的是總數**，而時間軸只畫得出有時間的那部分 ——
   * 兩者不一致時由時間軸自己說出來（「另有 N 堂未排定時間」），不在這裡對齊。
   */
  protected readonly todayHeadline = computed(() => {
    const sessions = this.todaySessions();
    if (sessions === null || sessions === FAILED) return null;
    const untaken = sessions.filter((s) => s.takenAt === null).length;
    return { total: sessions.length, untaken };
  });

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));

    // **逐支訂閱，不用單一 forkJoin。** forkJoin 要全部完成才 emit，於是整頁
    // 等最慢的那一支 —— 橘帶那句話可能是最早回來的，卻要等最後一支。
    //
    // 次序照**畫面由上而下**，不照快慢。照快慢排的話畫面會跳來跳去
    // （design-web-2 的提醒）：橘帶 → 待處理 → 現況欄。
    //
    // ⚠️ 這是**體感的改善，不是延遲的改善**。billing-api 量到那 8 支即使
    // 完全不碰資料庫，並行仍比序列慢 2.4 倍（fan-out 本身的成本），而且
    // guard 的 `await auth.ready` 是序列跳板，總時間 ≈ TTFB(/api/me) + max(8 支)。
    // 真正的延遲那條在 pooler 設定，不在這裡。見
    // kb/wiki/lessons/workers-fanout-costs-before-the-db.md
    // `takeUntilDestroyed` 的泛型是在呼叫點推導的 —— 存成 const 會把 T 定死成
    // `unknown`，後面每個 subscribe 的 res 都變 unknown。所以逐一 inline 呼叫。

    // ① 橘帶＋作業台主體：**一支取代兩支**（今日課表 + 點名模式）。
    //
    // 原本這兩件事分兩支發，於是「今天幾堂課」與「這個機構怎麼點名」會在不同時間
    // 抵達，畫面先用 per_session 的語言渲一次再改口。合成一支之後兩者同時到 ——
    // 而**形狀的判斷本來就該只有一份，在伺服器**。
    //
    // 日到班模式下這一支還順便帶回應到／已到／請假，前端不必再打三支。
    failSoft(this.workbenchService.today())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res === FAILED) {
          this.todaySessions.set(FAILED);
          return;
        }
        this.todaySessions.set(res.sessions);
        this.attendanceMode.set(res.mode);
        this.workbench.set(res);
      });

    /**
     * 未點名課堂——**一支查完**。`endedOnly=true` 把「已經上完」的判斷搬到伺服器
     * （#368），不用再拆成「昨天以前查 API、今天前端逐筆濾」兩段。`pageSize: 1`
     * 取 `meta.total`，數字完全由伺服器算，前端不重算一次——這是計畫席當時的
     * 硬性條件：後端能表達之後，卡片數字整個來自伺服器。
     */
    failSoft(
      this.attendanceService.sessions({
        ...this.untakenQuery(),
        pageSize: 1,
      }),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.untakenCount.set(res === FAILED ? FAILED : res.meta.total));

    failSoft(
      forkJoin([this.academyExamsService.getTodoCount(), this.schoolExamsService.getTodoCount()]),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) =>
        this.gradesTodo.set(res === FAILED ? FAILED : res[0].count + res[1].count),
      );

    // ③ 現況欄：背景脈絡，最後填也不影響使用者在做的事
    failSoft(this.leaveService.list({ coverDate: this.todayIso, pageSize: 100 }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.todayLeaves.set(res === FAILED ? FAILED : res.data));

    failSoft(this.studentsService.list({ pageSize: 1 }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) =>
        this.activeStudents.set(res === FAILED ? FAILED : res.summary.activeCount),
      );

    // 只要 meta.total：pageSize 上限是 100，抓明細自己分類會在異動破百的月份
    // 悄悄少算，而且錯得沒有徵兆
    failSoft(
      this.enrollmentsService.list({
        from: format(startOfMonth(this.now), 'yyyy-MM-dd'),
        to: format(endOfMonth(this.now), 'yyyy-MM-dd'),
        pageSize: 1,
      }),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.enrollmentChanges.set(res === FAILED ? FAILED : res.meta.total));
  }
  /** 跟課堂管理用同一支推導 —— 兩個畫面對「漏點名」必須說一樣的話 */
  protected attendanceTone(session: EventSessionSummary): StatusTone {
    return toAttendanceTone(
      {
        time: { date: session.eventDate, startTime: session.startTime, endTime: session.endTime },
        cancelled: false,
        taken: session.takenAt !== null && session.takenAt !== undefined,
      },
      new Date(),
    );
  }
}
