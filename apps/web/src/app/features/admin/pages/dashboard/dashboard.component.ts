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
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { format } from 'date-fns';
import { catchError, of, type Observable } from 'rxjs';

import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { AuthService } from '@core/auth.service';
import { BillingPeriodsService, type UpcomingUnbilledPeriod } from '@core/billing-periods.service';
import { ContactLogsService } from '@core/contact-logs.service';
import { InvoicesService, type Invoice } from '@core/invoices.service';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { OrgSettingsService, type AttendanceMode } from '@core/org-settings.service';
import { RoutesCatalog, type RouteObj } from '@core/smart-enums/routes-catalog';

import { PageActionsComponent } from '@shared/components/page-actions/page-actions.component';
import { PageOpenComponent } from '@shared/components/page-open/page-open.component';

import {
  missingReason,
  missingText,
  pendingAttendanceQuery,
  toMinutes,
  type MissingReason,
} from './dashboard.util';
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
  readonly routerLink: string;
  /**
   * 帶去目的頁的篩選——**沒有這個欄位，卡片的數字跟落地頁篩選後看到的東西
   * 永遠是兩件事**（P1-6：kb/wiki/architecture/admin-todo-alerts.md）。
   * 沒有篩選需求的卡片就不填，模板綁 `card.queryParams ?? {}`。
   */
  readonly queryParams?: Readonly<Record<string, string>>;
}

/** 到班名冊裡一個人的狀態；排序也照這個順序（要處理的在最上面） */
type RosterState = 'missing' | 'arrived' | 'not_yet' | 'on_leave';
const ROSTER_RANK: Record<RosterState, number> = {
  missing: 0,
  arrived: 1,
  not_yet: 2,
  on_leave: 3,
};

interface RosterPerson {
  readonly student: WorkbenchExpectedStudent;
  readonly state: RosterState;
  readonly reason: MissingReason | null;
  readonly arrival: WorkbenchArrival | undefined;
}

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

const FAILED = 'error' as const;

/** 一張卡的查詢掛掉不該讓整頁空白，所以每支查詢各自把錯誤吞成 `'error'` */
function failSoft<T>(source: Observable<T>): Observable<T | typeof FAILED> {
  return source.pipe(catchError(() => of(FAILED)));
}

function countOf(items: readonly unknown[] | 'error' | null): CardValue {
  return items === null || items === FAILED ? items : items.length;
}

/** 回溯窗：昨天忘記點的今天要追得到，更久以前的漏點名是報表該查的異常 */
const UNTAKEN_LOOKBACK_DAYS = 7;

/** 「逾期帳單」摺疊列展開後列幾筆（A6：前 4 筆，其餘到帳單頁看） */
const OVERDUE_PREVIEW = 4;

import {
  WorkbenchService,
  type WorkbenchArrival,
  type WorkbenchExpectedStudent,
  type WorkbenchToday,
} from '@core/workbench.service';
import { DailyCheckinsService } from '@core/daily-checkins.service';
import {
  PhoneLeaveComponent,
  type PhoneLeaveRosterRequest,
} from './phone-leave/phone-leave.component';

@Component({
  selector: 'app-dashboard',
  imports: [
    StatusDotComponent,
    RouterLink,
    PhoneLeaveComponent,
    PageActionsComponent,
    PageOpenComponent,
    NgTemplateOutlet,
    DecimalPipe,
  ],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly leaveService = inject(LeaveService);
  private readonly billingPeriodsService = inject(BillingPeriodsService);
  private readonly invoicesService = inject(InvoicesService);
  private readonly workbenchService = inject(WorkbenchService);
  private readonly dailyCheckinsService = inject(DailyCheckinsService);
  private readonly contactLogsService = inject(ContactLogsService);
  private readonly orgSettings = inject(OrgSettingsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** 「現在」。每半分鐘更新一次 —— 「上課 40 分鐘了」與名冊的現在線會隨時間走 */
  private readonly now = signal(new Date());
  private readonly todayIso = format(this.now(), 'yyyy-MM-dd');
  private readonly nowMinutes = computed(
    () => this.now().getHours() * 60 + this.now().getMinutes(),
  );

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

    await this.openRosterDialog(
      {
        eventId: session.eventId,
        className: session.className,
        eventDate: session.eventDate,
        startTime: session.startTime,
        endTime: session.endTime,
      },
      (takenAt) =>
        // **就地更新，不重打 API。** 這一列的狀態剛剛才由 dialog 寫進去，
        // 再查一次只是把同一件事問兩遍，而且會讓那一列閃一下。
        this.todaySessions.update((sessions) =>
          sessions === null || sessions === FAILED
            ? sessions
            : sessions.map((item) =>
                item.sessionId === session.sessionId ? { ...item, takenAt } : item,
              ),
        ),
    );
  }

  /**
   * 開點名名單對話框。今日課表的「點名」與接到電話請假的結果卡（#964）共用這一份。
   * `onTaken` 只有在對話框裡真的存了點名時才會被叫。
   */
  protected async openRosterDialog(
    target: PhoneLeaveRosterRequest,
    onTaken?: (takenAt: string) => void,
  ): Promise<void> {
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
      width: '480px',
      modal: true,
      showHeader: false,
      closable: false,
      // 憲法 c6：不用 vw
      breakpoints: { '640px': '92%' },
      data: {
        eventId: target.eventId,
        className: target.className,
        eventDate: target.eventDate,
        timeRange:
          target.startTime && target.endTime ? `${target.startTime}–${target.endTime}` : undefined,
      },
      styleClass: 'session-dialog',
    });

    // open() 在沒有 document 的環境回 null
    ref?.onClose.subscribe((result?: { takenAt: string }) => {
      if (result) onTaken?.(result.takenAt);
    });

    // 離開這條路由時彈窗要跟著消失。用 destroy() 不是 close() ——
    // close() 會走 onClose，那條路的意思是「使用者存了檔」。
    this.destroyRef.onDestroy(() => ref?.destroy());
  }

  // ── 日到班看板 ────────────────────────────────────────────────────────
  //
  // **晨間視角是「誰該到沒到」，不是「誰到了」。** 一張列出全部學生的表，行政要自己
  // 掃描找出缺口；而晨間真正的工作是**追該到沒到的人**（打電話問家長、確認是不是請假）。
  //
  // 主區只放「第一堂已經開始、還沒到、沒請假」的人（A6）；還沒到上課時間的人在
  // 摺疊的到班名冊裡，不佔主區。

  protected readonly isDailyCheckin = computed(() => this.attendanceMode() === 'daily_checkin');

  // ── 登記請假（#964 接到電話就地請假；A6 工具列／托盤的「登記請假」）─────────
  // 寫入走既有 `POST /api/leaves`，它要求 `basic_operations` —— 沒有的人連入口都不給
  protected readonly canPhoneLeave = computed(() => this.auth.hasPermission('basic_operations'));
  protected readonly phoneLeaveOpen = signal(false);
  /** 從「該到沒到」那一列開的：預帶那位學生 */
  protected readonly phoneLeaveStudentId = signal<string | null>(null);

  /** A6 的「臨時狀況？」三個入口；本站沒有各自的情境頁，都從課表頁出發 */
  protected readonly emergencyLinks = [
    { title: '颱風、停電', hint: '整天停課' },
    { title: '老師請假', hint: '整週找人代課' },
    { title: '班級改時段', hint: '整期一起改' },
  ] as const;

  protected readonly leavePrimary = { label: '登記請假' };
  protected readonly leaveSecondary = { label: '櫃台代刷到班' };

  protected openPhoneLeave(studentId: string | null = null): void {
    this.phoneLeaveStudentId.set(studentId);
    this.phoneLeaveOpen.set(true);
    // 面板在頁面上方，從列內按時要把它帶進視野
    queueMicrotask(() =>
      document
        .getElementById('dashboard-phone-leave')
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
    );
  }

  protected closePhoneLeave(): void {
    this.phoneLeaveOpen.set(false);
    this.phoneLeaveStudentId.set(null);
  }

  /** 櫃台代刷＝到班打卡站（掃 QR）。登記請假用同一顆托盤鈕，不經這裡 */
  protected openCheckinStation(): void {
    void this.router.navigateByUrl(RoutesCatalog.ADMIN_CHECKIN.absolutePath);
  }

  private readonly arrivedById = computed(
    () => new Map((this.workbench()?.arrived ?? []).map((a) => [a.studentId, a])),
  );

  private readonly onLeaveIds = computed(
    () => new Set((this.workbench()?.onLeave ?? []).map((leave) => leave.studentId)),
  );

  /** 每個人的名冊狀態。判定只有一份：missing 與否交給 `missingReason` */
  private readonly rosterPeople = computed<RosterPerson[]>(() => {
    const arrived = this.arrivedById();
    const onLeave = this.onLeaveIds();
    const sessions = this.workbench()?.sessions ?? [];
    const nowMin = this.nowMinutes();

    return (this.workbench()?.expected ?? []).map((student) => {
      const arrival = arrived.get(student.studentId);
      const reason = missingReason(student.firstSession, sessions, nowMin);
      const state: RosterState = arrival
        ? 'arrived'
        : onLeave.has(student.studentId)
          ? 'on_leave'
          : reason
            ? 'missing'
            : 'not_yet';
      return { student, state, reason, arrival };
    });
  });

  /** 該到沒到：開始時間早的在上面（最久沒到的先處理） */
  protected readonly missingRows = computed(() =>
    this.rosterPeople()
      .filter((p) => p.state === 'missing' && p.reason !== null)
      .sort((a, b) =>
        (a.student.firstSession?.startTime ?? '').localeCompare(
          b.student.firstSession?.startTime ?? '',
        ),
      )
      .map((p) => ({
        student: p.student,
        text: missingText(p.reason!),
        // 家長沒有帳號 → 沒有電話；沒有家長 → 兩個都沒有。都要說出來，不要空白
        parent: p.student.primaryParent,
        contactedAt: p.student.lastContact ? this.clock(p.student.lastContact.at) : null,
      })),
  );

  /** 到班名冊：依「今天最早那堂」分章，現在線插在第一個還沒開始的章前面 */
  protected readonly rosterChapters = computed(() => {
    const groups = new Map<string, { people: RosterPerson[]; classNames: Set<string> }>();
    for (const person of this.rosterPeople()) {
      const key = person.student.firstSession?.startTime ?? '';
      const group = groups.get(key) ?? { people: [], classNames: new Set<string>() };
      group.people.push(person);
      if (person.student.firstSession) group.classNames.add(person.student.firstSession.className);
      groups.set(key, group);
    }

    const nowMin = this.nowMinutes();
    let nowPlaced = false;
    return [...groups.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([time, group]) => {
        const start = toMinutes(time);
        const nowBefore = !nowPlaced && start !== null && start > nowMin;
        if (nowBefore) nowPlaced = true;
        return {
          time,
          nowBefore,
          classNames: [...group.classNames],
          arrivedCount: group.people.filter((p) => p.state === 'arrived').length,
          people: [...group.people].sort(
            (a, b) =>
              ROSTER_RANK[a.state] - ROSTER_RANK[b.state] ||
              (a.arrival?.checkedInAt ?? '').localeCompare(b.arrival?.checkedInAt ?? ''),
          ),
        };
      });
  });

  protected readonly rosterSummary = computed(() => {
    const people = this.rosterPeople();
    const arrived = people.filter((p) => p.state === 'arrived').length;
    const onLeave = people.filter((p) => p.state === 'on_leave').length;
    return `到 ${arrived}／${people.length} · 請假 ${onLeave}`;
  });

  protected readonly boardBusy = signal<string | null>(null);
  protected readonly boardError = signal<string | null>(null);

  protected readonly nowText = computed(() => format(this.now(), 'HH:mm'));

  /** `HH:mm`。打卡時間是 ISO 字串，而行政要看的是「幾點到的」。 */
  protected clock(isoTime: string): string {
    const at = new Date(isoTime);
    return Number.isNaN(at.getTime())
      ? '—'
      : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * 打電話（#1314 D2）：撥號交給 `tel:` 連結（模板），這裡只負責**記一筆聯絡**。
   * 記錄成功才把那一列換成「已聯絡 HH:mm」—— 用回應的時間，不猜。
   * 沒記成功就留在原地並說出來，列不能假裝聯絡過了。
   */
  protected recordCall(student: WorkbenchExpectedStudent): void {
    if (this.boardBusy() !== null) return;
    this.boardBusy.set(student.studentId);
    this.boardError.set(null);

    this.contactLogsService
      .create({ studentId: student.studentId, channel: 'phone' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.workbench.update((current) =>
            current === null
              ? current
              : {
                  ...current,
                  expected: current.expected.map((s) =>
                    s.studentId === student.studentId
                      ? { ...s, lastContact: { at: data.createdAt, channel: data.channel } }
                      : s,
                  ),
                },
          );
          this.boardBusy.set(null);
        },
        error: () => {
          this.boardError.set(`沒能記下對 ${student.studentName} 家長的聯絡，請再試一次。`);
          this.boardBusy.set(null);
        },
      });
  }

  /**
   * 勾到班（櫃台代刷）。
   *
   * **勾完只顯示「已到班 09:12」，不顯示「已為 N 堂課記錄出席」** —— 後者取決於
   * API 那邊的散播規則（`#178`：只寫他有報名的課），是機器的推論而不是觀察到的
   * 事實。把推論寫成事實，之後規則一改那句話就變成謊。
   */
  protected checkIn(student: WorkbenchExpectedStudent): void {
    if (this.boardBusy() !== null) return;
    this.boardBusy.set(student.studentId);
    this.boardError.set(null);

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

  /**
   * 工具列上的日期與時刻。**在這裡算而不是用 DatePipe 帶 locale** ——
   * `registerLocaleData(localeZhTW)` 是在 `app.config.ts` 跑的，TestBed 不載它，
   * 所以 `date: … : 'zh-TW'` 在測試環境會炸「Missing locale data」。
   * 星期用自己的陣列，不依賴任何 locale 註冊。
   */
  protected readonly todayLabel = computed(
    () =>
      `${format(this.now(), 'M 月 d 日')} ${WEEKDAYS[this.now().getDay()]} ${format(this.now(), 'HH:mm')}`,
  );

  private readonly todaySessions = signal<EventSessionSummary[] | 'error' | null>(null);
  /**
   * 未點名堂數，**整個來自伺服器**（`endedOnly` 到位後不再拆兩段查、
   * 前端也不再算一次——同一個數字算兩次是這張卡先前對不上落地頁的根因）。
   */
  private readonly untakenCount = signal<CardValue>(null);
  private readonly todayLeaves = signal<LeaveRequest[] | 'error' | null>(null);
  /**
   * 待開單（#1293）：14 天內開始、有期繳生卻還沒開單的期。系統沒有排程提醒，行政只看得到這裡。
   * 只有 `manage_finance` 的人會載入（開單是財務動作，端點也掛這個權限）。
   */
  private readonly unbilledPeriods = signal<readonly UpcomingUnbilledPeriod[] | 'error' | null>(
    null,
  );
  /** 逾期帳單摘要（#1314 D6）。同樣只有 `manage_finance` 載入；`null` = 還不知道 */
  protected readonly overdueSummary = signal<
    { count: number; amount: number } | typeof FAILED | null
  >(null);
  protected readonly overdueList = signal<readonly Invoice[]>([]);
  protected readonly canSeeOverdue = computed(() => this.auth.hasPermission('manage_finance'));
  protected readonly overdueRoute = RoutesCatalog.ADMIN_PAYMENTS.absolutePath;
  protected readonly studentRoute = RoutesCatalog.ADMIN_STUDENT_DETAIL.absolutePath;
  protected readonly sessionsRoute = RoutesCatalog.ADMIN_SESSIONS.absolutePath;
  /** `null` 代表讀不到機構設定 */
  private readonly attendanceMode = signal<AttendanceMode | null>(null);
  /** 日到班看板要用的那三段（應到／已到／請假）。逐堂模式下它們是空陣列。 */
  private readonly workbench = signal<WorkbenchToday | null>(null);

  /** 主標：機構名。還沒載到是 `null`（骨架），讀不到才退回頁名 */
  protected readonly orgName = computed(() => {
    if (this.orgSettings.status() === 'failed') return this.page().label;
    return this.orgSettings.settings()?.name ?? null;
  });

  /** 分校小字：只有今天的資料全落在同一個分校時才寫，跨分校的機構不挑一個 */
  protected readonly campusName = computed(() => {
    const names = new Set(
      [
        ...(this.workbench()?.sessions ?? []).map((s) => s.campusName),
        ...(this.workbench()?.expected ?? []).map((s) => s.campusName),
      ].filter((name): name is string => !!name),
    );
    return names.size === 1 ? [...names][0] : null;
  });

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

  /** 「林媽媽（母親）」；沒有關係就只有名字。拼在這裡是因為模板的換行會在中間長出空白 */
  protected parentLabel(parent: { name: string; relation: string | null } | null): string {
    return parent ? `${parent.name}${parent.relation ? `（${parent.relation}）` : ''}` : '';
  }

  /** 逾期列右邊的金額：未收餘額（總額 − 已收淨額） */
  protected balance(invoice: Invoice): number {
    return invoice.total - invoice.netPaid;
  }

  /** A6 的請假列右側：「家長 app」或「櫃台」 */
  protected leaveSource(leave: LeaveRequest): string {
    return leave.submittedByRole === 'parent' ? '家長 app' : '櫃台';
  }

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
    pendingAttendanceQuery(this.now(), UNTAKEN_LOOKBACK_DAYS),
  );

  /**
   * 待處理：只有真的要動作的才進來（A6 沒畫這一列，但這兩項是已接通的提醒，保留）。
   * 「成績待登錄」、「現況」數字卡在 #1314 D 移除 —— A6 儀表板沒有它們。
   */
  protected readonly todoCards = computed<StatCard[]>(() => {
    const cards: StatCard[] = [];

    const untaken = this.untaken();
    if (untaken !== 'hidden') {
      const query = this.untakenQuery();
      cards.push({
        label: '未點名課堂',
        value: untaken,
        sub: `近 ${UNTAKEN_LOOKBACK_DAYS} 天`,
        routerLink: RoutesCatalog.ADMIN_ATTENDANCE.absolutePath,
        queryParams: {
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          attendanceTaken: String(query.attendanceTaken),
          endedOnly: String(query.endedOnly),
          // 明著帶過去，落地頁才不會退回它自己的 `DEFAULT_STATUSES`（#456）
          statuses: query.statuses.join(','),
        },
      });
    }

    // 沒有待開的期就不出現（不是顯示 0）—— 一學期才一次的事，平常不該佔一格
    const unbilled = this.unbilledPeriods();
    if (unbilled === FAILED || (unbilled && unbilled.length > 0)) {
      const first = unbilled === FAILED ? null : unbilled[0];
      cards.push({
        label: '待開單',
        value: unbilled === FAILED ? FAILED : unbilled.length,
        sub: first ? `${first.name} ${formatMonthDay(first.startDate)} 開始` : undefined,
        routerLink: RoutesCatalog.ADMIN_MEALS.absolutePath,
        // 帶去開單對話框、直接選好那一期 —— 卡片說的那一期就是點進去開的那一期（P1-6）
        queryParams: first ? { billingRun: 'period', periodId: first.periodId } : undefined,
      });
    }

    return cards;
  });

  /**
   * Hero 副行。日到班講「人」（A6）；逐堂點名的機構沒有「掃碼到班」，仍講「堂」。
   */
  protected readonly todayHeadline = computed(() => {
    const board = this.workbench();
    const sessions = this.todaySessions();
    if (board === null || sessions === null || sessions === FAILED) return null;

    if (board.mode === 'daily_checkin') {
      return `今天 ${board.expected.length} 人要來，已經到了 ${board.arrived.length} 位。`;
    }

    // **停課的不算未點名**（#686）—— 它永遠不會被點，算進去等於宣稱有一件
    // 做不完的事。`total` 刻意**不**排除停課：總數少一堂的話這句話會跟下面的清單對不上。
    const untaken = sessions.filter((s) => s.status !== 'cancelled' && s.takenAt === null).length;
    if (sessions.length === 0) return '今天沒有排課。';
    return untaken === 0
      ? `今天 ${sessions.length} 堂課，全部點完了。`
      : `今天 ${sessions.length} 堂課，其中 ${untaken} 堂還沒點名。`;
  });

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));

    const tick = setInterval(() => this.now.set(new Date()), 30_000);
    this.destroyRef.onDestroy(() => clearInterval(tick));

    if (this.orgSettings.status() === 'unloaded') this.orgSettings.load();

    // **逐支訂閱，不用單一 forkJoin。** forkJoin 要全部完成才 emit，於是整頁
    // 等最慢的那一支。次序照**畫面由上而下**，不照快慢，畫面才不會跳來跳去。
    //
    // ⚠️ 這是**體感的改善，不是延遲的改善**，見
    // kb/wiki/lessons/workers-fanout-costs-before-the-db.md
    // `takeUntilDestroyed` 的泛型是在呼叫點推導的 —— 存成 const 會把 T 定死成
    // `unknown`，後面每個 subscribe 的 res 都變 unknown。所以逐一 inline 呼叫。

    // ① Hero＋作業台主體：**一支取代兩支**（今日課表 + 點名模式）。
    // 形狀的判斷本來就該只有一份，在伺服器。日到班模式下這一支還順便帶回
    // 應到／已到／請假（連同家長電話與今天的聯絡），前端不必再打。
    this.loadWorkbench();

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

    if (this.auth.hasPermission('manage_finance')) {
      failSoft(this.billingPeriodsService.upcomingUnbilled())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => this.unbilledPeriods.set(res === FAILED ? FAILED : res.data));

      // 逾期帳單（D6）：張數與金額由伺服器加總，列表只取前幾筆
      failSoft(this.invoicesService.summary())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((res) =>
          this.overdueSummary.set(
            res === FAILED ? FAILED : { count: res.overdue.count, amount: res.overdue.outstanding },
          ),
        );
      failSoft(this.invoicesService.list({ overdue: true, pageSize: OVERDUE_PREVIEW }))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => this.overdueList.set(res === FAILED ? [] : res.data));
    }

    this.loadTodayLeaves();
  }

  /**
   * 重抓「今日」—— 接到電話請假送出後叫（#964）：讓剛登記的假也出現在底下的看板上
   * （日到班模式：從「該到沒到」移到請假）。只重抓會被請假改到的那兩支。
   */
  protected loadToday(): void {
    this.loadWorkbench();
    this.loadTodayLeaves();
  }

  private loadWorkbench(): void {
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
  }

  private loadTodayLeaves(): void {
    failSoft(this.leaveService.list({ coverDate: this.todayIso, pageSize: 100 }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => this.todayLeaves.set(res === FAILED ? FAILED : res.data));
  }

  protected readonly leaveCount = computed(() => countOf(this.todayLeaves()));

  /** 跟課堂管理用同一支推導 —— 兩個畫面對「漏點名」必須說一樣的話 */
  protected attendanceTone(session: EventSessionSummary): StatusTone {
    return toAttendanceTone(
      {
        time: { date: session.eventDate, startTime: session.startTime, endTime: session.endTime },
        // **原本寫死 `false`（#686）** —— 共用推導本來就有停課分支（回 `inactive`），
        // 而這裡把它關掉了，於是一堂停課被算成「上完了卻沒點」。
        cancelled: session.status === 'cancelled',
        taken: session.takenAt !== null && session.takenAt !== undefined,
      },
      new Date(),
    );
  }

  /**
   * 狀態點旁邊那行字。**一個方法，不是模板裡兩份三元運算式**（#686）。
   *
   * 原本可按與不可按兩個分支各寫一次 `takenAt ? '已點名' : '未點名'`，
   * 而**兩份都沒有停課分支** —— 一堂停掉的課顯示成「未點名」，
   * 但它點不下去，也沒有任何地方說那是因為停課。這一頁說有 2 件事要做，
   * 其中一件永遠做不完。
   *
   * **為什麼是「已停課」而不是課堂管理用的「不適用」**：那一頁同一列
   * **另有一欄**寫著「已停課」，所以「不適用」有東西撐著。**儀表板一列只有一個
   * 狀態位**，用「不適用」的話使用者看不出為什麼。
   *
   * 沒有直接引用老師端那份 `Record`：跨 feature import 違反 c5，
   * 而為了兩個字把它提到 `shared/` 會連帶把「還沒上／漏點名」那兩個
   * 儀表板從來不說的字一起帶進來。
   */
  protected attendanceLabel(session: EventSessionSummary): string {
    if (session.status === 'cancelled') return '已停課';
    return session.takenAt ? '已點名' : '未點名';
  }

  /** 這一列算不算「今天還要處理的事」——停課的不算（#686） */
  protected isTodo(session: EventSessionSummary): boolean {
    return session.status !== 'cancelled' && !session.takenAt;
  }
}

/** `2026-10-15` → `10 月 15 日` */
function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)} 月 ${Number(day)} 日`;
}
