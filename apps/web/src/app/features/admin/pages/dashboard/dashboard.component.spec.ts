import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { AuthService } from '@core/auth.service';
import { BillingPeriodsService, type UpcomingUnbilledPeriod } from '@core/billing-periods.service';
import { ContactLogsService } from '@core/contact-logs.service';
import { InvoicesService } from '@core/invoices.service';
import { LeaveService, type LeaveRequest } from '@core/leave.service';
import { OrgSettingsService, type AttendanceMode } from '@core/org-settings.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { WorkbenchService, type WorkbenchExpectedStudent } from '@core/workbench.service';
import { DailyCheckinsService } from '@core/daily-checkins.service';
import { StudentsService } from '@core/students.service';
import { SystemClockService } from '@core/system-clock.service';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { DashboardComponent } from './dashboard.component';
import { format } from 'date-fns';

// 用本地時區算「今天」，跟元件的 date-fns format 一致 ——
// toISOString() 是 UTC，在 UTC+8 的凌晨那幾小時會跟元件差一天，測試就假紅。
const TODAY = format(new Date(), 'yyyy-MM-dd');
/** 回溯窗裡「已經結束」的那一天 —— 今天的課還沒上完，不算漏點名 */
const YESTERDAY = format(new Date(Date.now() - 86_400_000), 'yyyy-MM-dd');

function session(overrides: Partial<EventSessionSummary> = {}): EventSessionSummary {
  return {
    eventId: 'e1',
    sessionId: 's1',
    status: 'scheduled',
    isSubstitute: false,
    examCount: 0,
    classId: 'c1',
    className: '數學班 A',
    usesContactBook: false,
    courseName: '數學',
    teacherName: '王老師',
    campusId: null,
    campusName: null,
    eventDate: TODAY,
    startTime: '00:01',
    endTime: '23:59',
    enrolledCount: 8,
    presentCount: 0,
    onLeaveCount: 0,
    absentCount: 0,
    takenAt: null,
    ...overrides,
  };
}

function leave(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'l1',
    orgId: 'o1',
    studentId: 's1',
    studentName: '陳小明',
    startDate: TODAY,
    endDate: TODAY,
    startTime: null,
    endTime: null,
    reason: null,
    submittedBy: 'u1',
    submittedByRole: 'parent',
    submittedByName: null,
    createdAt: `${TODAY}T00:00:00Z`,
    ...overrides,
  };
}

function expectedStudent(over: Partial<WorkbenchExpectedStudent> = {}): WorkbenchExpectedStudent {
  return {
    studentId: 'stu-1',
    studentName: '林小明',
    grade: '七年級',
    campusId: 'campus-a',
    campusName: '本館',
    firstSession: { startTime: '09:00', className: '數學班 A' },
    primaryParent: { name: '林媽媽', relation: '母親', phone: '0912345678' },
    lastContact: null,
    ...over,
  };
}

interface SetupOptions {
  /** #1293 待開單：`fail` = 端點失敗 */
  unbilled?: UpcomingUnbilledPeriod[] | 'fail';
  /** 日到班看板的三段。逐堂模式的測試不必給。 */
  workbenchExpected?: WorkbenchExpectedStudent[];
  workbenchArrived?: { studentId: string; checkedInAt: string; checkinId: string }[];
  workbenchOnLeave?: {
    studentId: string;
    studentName: string;
    startDate: string;
    endDate: string;
    submittedByRole: string;
    reason?: string | null;
  }[];
  todaySessions?: EventSessionSummary[];
  recentSessions?: EventSessionSummary[];
  leaves?: LeaveRequest[];
  mode?: AttendanceMode;
  permissions?: string[];
  overdue?: { count: number; amount: number };
  fail?: 'sessions' | 'leaves' | 'org';
  /** 讓查詢永遠不回覆，用來驗「載入中」而不是「空」 */
  pending?: boolean;
  /** 只讓「今日課表」回覆，其餘永遠不回 —— 用來驗漸進渲染 */
  onlySessions?: boolean;
  orgName?: string | null;
}

describe('DashboardComponent（管理端）', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;

  const sessionsMock = vi.fn();
  const leavesMock = vi.fn();
  const workbenchMock = vi.fn();
  const checkInMock = vi.fn();
  const cancelMock = vi.fn();
  const unbilledMock = vi.fn();
  const contactMock = vi.fn();
  const summaryMock = vi.fn();
  const invoiceListMock = vi.fn();
  const studentGetMock = vi.fn();
  const orgLoadMock = vi.fn();

  function sessionList(data: EventSessionSummary[]) {
    return of({
      data,
      meta: { total: data.length, page: 1, pageSize: 100, totalPages: 1 },
    });
  }

  async function setup(options: SetupOptions = {}) {
    const {
      todaySessions = [session()],
      recentSessions = [session()],
      leaves = [leave()],
      mode = 'per_session',
      permissions = ['view_reports'],
      fail,
      pending,
      onlySessions,
      workbenchExpected = [],
      workbenchArrived = [],
      workbenchOnLeave = [],
      unbilled = [],
      overdue = { count: 0, amount: 0 },
      orgName = '示範補習班',
    } = options;
    unbilledMock.mockReset();
    unbilledMock.mockReturnValue(
      unbilled === 'fail' ? throwError(() => new Error('boom')) : of({ data: unbilled }),
    );

    /**
     * 漸進渲染測試用：只讓「今日課表」那一支回覆，其餘永遠不回。
     * 用單一 forkJoin 的話畫面會完全空白 —— 那正是這一刀要修掉的。
     */
    const stalled = onlySessions === true;

    const boom = throwError(() => new Error('boom'));

    for (const mock of [
      sessionsMock,
      leavesMock,
      workbenchMock,
      checkInMock,
      cancelMock,
      contactMock,
      summaryMock,
      invoiceListMock,
      studentGetMock,
      orgLoadMock,
    ]) {
      mock.mockReset();
    }

    // 未點名課堂**只有一支請求**（`endedOnly`）——「已經上完」的判斷是伺服器做的（#368），
    // mock 不重算一次，直接信 `recentSessions` 已經是「篩過的候選集合」。
    sessionsMock.mockImplementation((params: { attendanceTaken?: boolean; endedOnly?: boolean }) =>
      pending || stalled
        ? NEVER
        : fail === 'sessions'
          ? boom
          : sessionList(
              params.attendanceTaken === false
                ? recentSessions.filter((session) => !session.takenAt)
                : recentSessions,
            ),
    );
    leavesMock.mockReturnValue(
      pending || stalled
        ? NEVER
        : fail === 'leaves'
          ? boom
          : of({
              data: leaves,
              meta: { total: leaves.length, page: 1, pageSize: 100, totalPages: 1 },
            }),
    );
    summaryMock.mockReturnValue(
      stalled ? NEVER : of({ overdue: { count: overdue.count, outstanding: overdue.amount } }),
    );
    invoiceListMock.mockReturnValue(
      stalled
        ? NEVER
        : of({
            data:
              overdue.count > 0
                ? [
                    {
                      id: 'inv-1',
                      studentId: 'stu-9',
                      studentName: '黃小華',
                      dueDate: '2026-09-20',
                      total: 5000,
                      netPaid: 1000,
                    },
                  ]
                : [],
          }),
    );
    // 作業台的聚合端點：**一支帶回今日課表 + 點名模式 + 日到班的三段**。
    workbenchMock.mockReturnValue(
      pending
        ? NEVER
        : fail === 'sessions' || fail === 'org'
          ? boom
          : of({
              date: '2026-08-30',
              mode,
              sessions: todaySessions,
              rosters: [],
              expected: workbenchExpected,
              arrived: workbenchArrived,
              onLeave: workbenchOnLeave,
            }),
    );

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AttendanceService, useValue: { sessions: sessionsMock } },
        { provide: WorkbenchService, useValue: { today: workbenchMock } },
        {
          provide: DailyCheckinsService,
          useValue: { checkIn: checkInMock, cancel: cancelMock },
        },
        { provide: ContactLogsService, useValue: { create: contactMock } },
        { provide: InvoicesService, useValue: { summary: summaryMock, list: invoiceListMock } },
        { provide: LeaveService, useValue: { list: leavesMock } },
        { provide: StudentsService, useValue: { get: studentGetMock, list: vi.fn() } },
        { provide: BillingPeriodsService, useValue: { upcomingUnbilled: unbilledMock } },
        {
          provide: OrgSettingsService,
          useValue: {
            status: signal(fail === 'org' ? 'failed' : orgName === null ? 'unloaded' : 'ready'),
            settings: signal(orgName === null ? null : { id: 'o1', name: orgName }),
            load: orgLoadMock,
          },
        },
        {
          provide: AuthService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
        // 請假區（#964）的子元件用台北的今天；儀表板本身不用它
        { provide: SystemClockService, useValue: { todayTaipei: signal('2026-10-01') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_DASHBOARD);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el().querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const qa = (testId: string) => [
    ...el().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
  ];

  function cardLabels(): string[] {
    return component['todoCards']().map((c) => c.label);
  }

  function card(label: string) {
    return component['todoCards']().find((c) => c.label === label);
  }

  // 「已經上完」整個是伺服器算的（`endedOnly`）——前端只讀 meta.total，不再自己合併
  it('未點名數整個來自伺服器的 meta.total，前端不重算', async () => {
    await setup({
      recentSessions: [
        session({ eventId: 'r1', eventDate: YESTERDAY, takenAt: null }),
        session({ eventId: 'r2', eventDate: YESTERDAY, takenAt: null }),
        session({ eventId: 'r3', eventDate: YESTERDAY, takenAt: '2026-08-29T10:00:00Z' }),
      ],
    });

    expect(card('未點名課堂')?.value).toBe(2);
  });

  it('待處理只剩真的要動作的；成績待登錄與「現況」數字卡不再出現（A6 沒畫）', async () => {
    await setup({ permissions: ['view_reports'] });

    expect(cardLabels()).toEqual(['未點名課堂']);
    const text = el().textContent as string;
    expect(text).not.toContain('成績待登錄');
    expect(text).not.toContain('在籍學生');
    expect(text).not.toContain('本月報名異動');
    expect(el().querySelector('app-day-timeline')).toBeNull();
    expect(text).not.toContain('收合時間軸');
  });

  it('未點名課堂卡帶的 queryParams 跟它自己查詢用的參數一致', async () => {
    await setup();

    const query = sessionsMock.mock.calls[0][0];
    expect(card('未點名課堂')?.routerLink).toBe(RoutesCatalog.ADMIN_ATTENDANCE.absolutePath);
    expect(card('未點名課堂')?.queryParams).toEqual({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      attendanceTaken: String(query.attendanceTaken),
      endedOnly: String(query.endedOnly),
      statuses: query.statuses.join(','),
    });
  });

  it('今日課表走聚合端點，未點名那支帶 endedOnly 一次查完（含今天）', async () => {
    await setup();

    expect(workbenchMock).toHaveBeenCalledTimes(1);
    expect(sessionsMock).toHaveBeenCalledTimes(1);
    const query = sessionsMock.mock.calls[0][0];
    expect(query.endedOnly).toBe(true);
    expect(query.pageSize).toBe(1);
    expect(query.dateTo).toBe(TODAY);
  });

  it('日到班模式不渲染未點名卡', async () => {
    await setup({ mode: 'daily_checkin' });
    expect(cardLabels()).not.toContain('未點名課堂');
  });

  it('讀不到機構設定時不渲染未點名卡', async () => {
    await setup({ fail: 'org' });
    expect(cardLabels()).not.toContain('未點名課堂');
  });

  describe('待開單卡（#1293）', () => {
    const upcoming: UpcomingUnbilledPeriod = {
      periodId: 'p-1',
      name: '2027 上學期',
      startDate: '2026-10-15',
      daysUntil: 11,
      pendingEnrollmentCount: 8,
    };

    it('有 manage_finance 且有待開的期 → 待處理區出現，帶去開單 dialog 並選好那一期', async () => {
      await setup({ permissions: ['manage_finance'], unbilled: [upcoming] });
      expect(unbilledMock).toHaveBeenCalledTimes(1);
      expect(card('待開單')).toMatchObject({
        value: 1,
        sub: '2027 上學期 10 月 15 日 開始',
        routerLink: RoutesCatalog.ADMIN_MEALS.absolutePath,
        queryParams: { billingRun: 'period', periodId: 'p-1' },
      });
    });

    it('沒有待開的期 → 不出現（不是顯示 0）', async () => {
      await setup({ permissions: ['manage_finance'], unbilled: [] });
      expect(cardLabels()).not.toContain('待開單');
    });

    it('沒有 manage_finance → 不打端點、不出現', async () => {
      await setup({ permissions: ['view_reports'], unbilled: [upcoming] });
      expect(unbilledMock).not.toHaveBeenCalled();
      expect(cardLabels()).not.toContain('待開單');
    });

    it('端點失敗 → 卡片顯示失敗態，其他卡照常', async () => {
      await setup({ permissions: ['manage_finance'], unbilled: 'fail' });
      expect(card('待開單')?.value).toBe('error');
      expect(cardLabels()).toContain('未點名課堂');
    });
  });

  it('失敗態是小圖示配短字，不是骨架，也不是巨大數字樣式', async () => {
    await setup({ permissions: ['manage_finance'], unbilled: 'fail' });

    const failed = q('value-error');
    expect(failed).not.toBeNull();
    expect(failed!.textContent).toContain('讀取失敗');
    expect(failed!.querySelector('.pi-exclamation-triangle')).not.toBeNull();
  });

  it('未點名卡還在載入時顯示骨架條，不是站在數字位置上的純文字', async () => {
    await setup({ pending: true });
    // pending 讓 workbench 也不回 → mode 未知 → 卡片本身隱藏；骨架出現在 Hero
    expect(q('band-skeleton') ?? el().querySelector('.skeleton-bar')).not.toBeNull();
  });

  it('今日課表列出今天的課，依開始時間排序', async () => {
    await setup({
      todaySessions: [
        session({ eventId: 'late', startTime: '19:00' }),
        session({ eventId: 'early', startTime: '09:00' }),
      ],
    });

    expect(component['todaySessionList']()?.map((s) => s.eventId)).toEqual(['early', 'late']);
  });

  describe('色面（Hero）', () => {
    it('主標是機構名；分校只有一個時寫在小字', async () => {
      await setup({
        mode: 'daily_checkin',
        workbenchExpected: [expectedStudent({ campusName: '文山旗艦校' })],
        todaySessions: [session({ campusName: '文山旗艦校' })],
      });

      const band = el().querySelector('app-page-open') as HTMLElement;
      expect(band.textContent).toContain('示範補習班');
      expect(band.textContent).toContain('文山旗艦校');
    });

    it('跨分校時不挑一個分校寫', async () => {
      await setup({
        mode: 'daily_checkin',
        workbenchExpected: [
          expectedStudent({ studentId: 'a', campusName: '甲校' }),
          expectedStudent({ studentId: 'b', campusName: '乙校' }),
        ],
      });

      const band = el().querySelector('app-page-open') as HTMLElement;
      expect(band.textContent).not.toContain('甲校');
      expect(band.textContent).not.toContain('乙校');
    });

    it('機構名還沒載到 → 骨架，不是空白也不是假名字', async () => {
      await setup({ orgName: null });
      expect(q('band-skeleton')).not.toBeNull();
      expect(orgLoadMock).toHaveBeenCalled();
    });

    it('日到班：副行講人（今天 N 人要來，已經到了 M 位）', async () => {
      await setup({
        mode: 'daily_checkin',
        workbenchExpected: [
          expectedStudent({ studentId: 'a' }),
          expectedStudent({ studentId: 'b' }),
          expectedStudent({ studentId: 'c' }),
        ],
        workbenchArrived: [{ studentId: 'a', checkedInAt: `${TODAY}T01:00:00Z`, checkinId: 'k1' }],
      });

      expect((el().querySelector('app-page-open') as HTMLElement).textContent).toContain(
        '今天 3 人要來，已經到了 1 位。',
      );
    });

    it('橘帶不等其他請求 —— 聚合端點一到就先渲染', async () => {
      await setup({ onlySessions: true, todaySessions: [session(), session({ eventId: 'e2' })] });

      expect((el().querySelector('app-page-open') as HTMLElement).textContent).toContain(
        '今天 2 堂課',
      );
      expect(q('band-skeleton')).toBeNull();
    });

    it('載入中不得宣稱今天沒有排課', async () => {
      await setup({ pending: true });
      expect(el().textContent).not.toContain('今天沒有排課');
    });
  });

  describe('就地點名', () => {
    function rows(): HTMLElement[] {
      return [...fixture.nativeElement.querySelectorAll('[data-testid="spine-row"]')];
    }

    it('逐堂點名模式下，有 eventId 的課堂整列是按鈕', async () => {
      await setup({ mode: 'per_session' });

      const actionable = rows().filter((r) => r.tagName === 'BUTTON');
      expect(actionable.length).toBeGreaterThan(0);
    });

    // 日到班模式沒有逐堂出勤這回事，做成可按會是個假 affordance
    it('日到班模式下沒有任何一列可按', async () => {
      await setup({ mode: 'daily_checkin' });

      expect(rows().every((r) => r.tagName !== 'BUTTON')).toBe(true);
    });

    /**
     * `DialogService` 與面板都是 `await import(...)`（不讓整棵 dialog 依賴樹進儀表板
     * 的 chunk），而 import 是非同步的 —— 使用者可能在那中間就離開了。
     *
     * 沒有守衛的話會在已銷毀的 injector 上開窗，留下一個沒有主人的彈窗（NG0911）。
     * **突變測試抓到過**：拿掉 `if (this.destroyed) return` 時，原本整組測試仍然全綠。
     */
    it('import 完成前元件就被銷毀時，安靜地不開窗', async () => {
      await setup({ mode: 'per_session' });

      const opening = component['openAttendance'](session());
      fixture.destroy();

      await expect(opening).resolves.toBeUndefined();
    });

    it('停課（沒有 eventId）的課堂不可按', async () => {
      await setup({
        mode: 'per_session',
        todaySessions: [{ ...session(), sessionId: 'no-event', eventId: null }],
      });

      expect(rows().every((r) => r.tagName !== 'BUTTON')).toBe(true);
    });
  });

  /**
   * #686：停課的課堂被顯示成「未點名」，而且算進「今天 N 堂還沒點名」。
   *
   * **同一列的可按性判斷有正確排除它**（`canTakeAttendance`），所以那一列刻意
   * 被渲染成不可按的靜態文字 —— 於是這一頁說有 2 件事要做，**其中一件永遠做不完**，
   * 而且沒有任何地方告訴使用者那是因為停課。
   *
   * 成因是**同一份判斷散在三處而只有一處記得停課**：狀態點的字（模板裡兩份三元）、
   * `--todo` 的高亮、以及 `attendanceTone` 那裡寫死的 `cancelled: false`。
   */
  describe('停課的課堂（#686）', () => {
    const cancelled = () =>
      session({ sessionId: 's-cancelled', eventId: null, status: 'cancelled' });

    /**
     * **取那一列，不是整頁的 textContent** —— 右欄有一張「未點名課堂」的卡，
     * 拿整頁去比對的話 `not.toContain('未點名')` 會撞到它，
     * 而那個失敗跟這條要驗的事情無關。
     */
    function rowText(): string {
      const row = fixture.nativeElement.querySelector('[data-testid="spine-row"]') as HTMLElement;
      return row?.textContent ?? '';
    }

    function bandText(): string {
      const band = fixture.nativeElement.querySelector('app-page-open') as HTMLElement;
      return band?.textContent ?? '';
    }

    it('狀態點說「已停課」，不是「未點名」', async () => {
      await setup({ mode: 'per_session', todaySessions: [cancelled()] });

      expect(rowText()).toContain('已停課');
      expect(rowText()).not.toContain('未點名');
    });

    /**
     * **為什麼是「已停課」而不是課堂管理的「不適用」**：那一頁同一列另有一欄
     * 寫著「已停課」撐著，儀表板一列只有一個狀態位。
     */
    it('不用「不適用」—— 這一列沒有第二欄可以解釋原因', async () => {
      await setup({ mode: 'per_session', todaySessions: [cancelled()] });

      expect(rowText()).not.toContain('不適用');
    });

    it('tone 是 inactive（不在等了，不該催），不是 overdue', async () => {
      await setup({ mode: 'per_session', todaySessions: [cancelled()] });

      const tone = (
        component as unknown as { attendanceTone: (s: EventSessionSummary) => string }
      ).attendanceTone(cancelled());
      expect(tone).toBe('inactive');
    });

    it('不帶 --todo 高亮 —— 它不是今天要處理的事', async () => {
      await setup({ mode: 'per_session', todaySessions: [cancelled()] });

      const row = fixture.nativeElement.querySelector('[data-testid="spine-row"]') as HTMLElement;
      expect(row.hasAttribute('data-todo')).toBe(false);
    });

    /**
     * 橘帶：**`untaken` 要排除停課，`total` 刻意不排除。**
     *
     * 時間軸照樣畫得出那一列（標成「已停課」），總數少一堂的話這句話會跟
     * 下面的清單對不上 —— 那是把一個看得見的矛盾換成另一個。
     */
    it('橘帶的「還沒點名」不含停課，而「幾堂課」照算', async () => {
      await setup({
        mode: 'per_session',
        todaySessions: [session(), cancelled()],
      });

      expect(bandText()).toContain('今天 2 堂課，其中 1 堂還沒點名');
    });
  });

  /**
   * 日到班看板（A6）。**晨間視角是「誰該到沒到、打給誰」** —— 只列第一堂已經開始、
   * 還沒到、沒請假的人；還沒到上課時間的在摺疊的到班名冊裡。
   */
  describe('日到班：該到沒到', () => {
    // 固定「現在」＝ 10:00：09:00 開始的算該到沒到、11:00 開始的還沒到時間
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
    });
    afterEach(() => vi.useRealTimers());

    async function board(options: SetupOptions = {}) {
      await setup({
        mode: 'daily_checkin',
        permissions: ['view_reports', 'basic_operations'],
        todaySessions: [
          session({ startTime: '09:00', endTime: '10:30', className: '數學班 A' }),
          session({
            sessionId: 's2',
            eventId: 'e2',
            startTime: '11:00',
            endTime: '12:00',
            className: '英文班 B',
          }),
        ],
        ...options,
      });
    }

    it('只列第一堂已開始、沒到、沒請假的人；還沒到時間的不在主區', async () => {
      await board({
        workbenchExpected: [
          expectedStudent({ studentId: 'late', studentName: '遲到者' }),
          expectedStudent({ studentId: 'here', studentName: '已到者' }),
          expectedStudent({ studentId: 'off', studentName: '請假者' }),
          expectedStudent({
            studentId: 'soon',
            studentName: '晚班者',
            firstSession: { startTime: '11:00', className: '英文班 B' },
          }),
        ],
        workbenchArrived: [
          { studentId: 'here', checkedInAt: `${TODAY}T01:00:00Z`, checkinId: 'k1' },
        ],
        workbenchOnLeave: [
          {
            studentId: 'off',
            studentName: '請假者',
            startDate: TODAY,
            endDate: TODAY,
            submittedByRole: 'parent',
          },
        ],
      });

      expect(qa('call-name').map((n) => n.textContent?.trim())).toEqual(['遲到者']);
      expect(el().querySelector('#dashboard-main-title')?.textContent).toContain(
        '該到沒到的 1 位，先打給家長',
      );
    });

    it('每列有：班與時間、紅字原因、家長稱謂與電話、打電話', async () => {
      await board({ workbenchExpected: [expectedStudent()] });

      const row = q('call-row')!;
      expect(row.textContent).toContain('09:00 數學班 A');
      expect(q('call-why')!.textContent).toContain('上課 1 小時了，還沒掃碼');
      expect(row.textContent).toContain('林媽媽（母親）');
      expect(q('call-phone')!.getAttribute('href')).toBe('tel:0912345678');
      expect(q('call-action')!.getAttribute('href')).toBe('tel:0912345678');
    });

    it('已下課的原因寫「已下課，今天沒掃碼」', async () => {
      vi.setSystemTime(new Date(`${TODAY}T11:30:00`));
      await board({ workbenchExpected: [expectedStudent()] });

      expect(q('call-why')!.textContent).toContain('已下課，今天沒掃碼');
    });

    it('沒有家長電話 → 沒有「打電話」，並說出原因', async () => {
      await board({
        workbenchExpected: [
          expectedStudent({ primaryParent: { name: '林媽媽', relation: '母親', phone: null } }),
        ],
      });

      expect(q('call-action')).toBeNull();
      expect(q('call-row')!.textContent).toContain('沒有留電話');
    });

    it('還沒登記家長 → 說出來，不是空白', async () => {
      await board({ workbenchExpected: [expectedStudent({ primaryParent: null })] });

      expect(q('call-action')).toBeNull();
      expect(q('call-row')!.textContent).toContain('還沒登記家長');
    });

    it('今天已經聯絡過 → 載入時就是「已聯絡 HH:mm」，不再顯示打電話', async () => {
      await board({
        workbenchExpected: [
          expectedStudent({
            lastContact: { at: `${TODAY}T09:42:00`, channel: 'phone' },
          }),
        ],
      });

      expect(q('contacted')!.textContent).toContain('已聯絡 09:42');
      expect(q('call-action')).toBeNull();
    });

    it('按「打電話」記一筆 phone 聯絡，成功後該列換成「已聯絡」', async () => {
      contactMock.mockReset();
      await board({ workbenchExpected: [expectedStudent()] });
      contactMock.mockReturnValue(
        of({
          data: { id: 'c1', studentId: 'stu-1', channel: 'phone', createdAt: `${TODAY}T10:05:00` },
        }),
      );

      // 不讓 jsdom 真的導向 tel:
      const link = q('call-action')!;
      link.addEventListener('click', (e) => e.preventDefault());
      link.click();
      fixture.detectChanges();

      expect(contactMock).toHaveBeenCalledWith({ studentId: 'stu-1', channel: 'phone' });
      expect(q('contacted')!.textContent).toContain('已聯絡 10:05');
      expect(q('call-action')).toBeNull();
    });

    // 連按防護：POST 還沒回來時再按不能再送一筆（聯絡紀錄只增不改不刪，重複的刪不掉）
    it('記錄中再按「打電話」不重送；回來後那一列才換成已聯絡', async () => {
      await board({ workbenchExpected: [expectedStudent()] });
      const reply = new Subject<{
        data: { id: string; studentId: string; channel: string; createdAt: string };
      }>();
      contactMock.mockReturnValue(reply);

      const link = q('call-action')!;
      link.addEventListener('click', (e) => e.preventDefault());
      link.click();
      link.click();
      link.click();
      fixture.detectChanges();

      expect(contactMock).toHaveBeenCalledTimes(1);

      reply.next({
        data: { id: 'c1', studentId: 'stu-1', channel: 'phone', createdAt: `${TODAY}T10:05:00` },
      });
      reply.complete();
      fixture.detectChanges();

      expect(q('contacted')!.textContent).toContain('已聯絡 10:05');
      expect(contactMock).toHaveBeenCalledTimes(1);
    });

    it('記不成功 → 該列不變，並提示再試一次（不假裝聯絡過）', async () => {
      await board({ workbenchExpected: [expectedStudent()] });
      contactMock.mockReturnValue(throwError(() => new Error('boom')));

      const link = q('call-action')!;
      link.addEventListener('click', (e) => e.preventDefault());
      link.click();
      fixture.detectChanges();

      expect(q('contacted')).toBeNull();
      expect(q('call-action')).not.toBeNull();
      expect(q('board-error')!.textContent).toContain('林小明');
    });

    it('「登記請假」開面板並預帶這位學生', async () => {
      await board({ workbenchExpected: [expectedStudent()] });
      // 預帶的取數交給子元件的 spec；這裡只守「有把學生 id 傳下去」
      studentGetMock.mockReturnValue(NEVER);
      q('leave-action')!.click();
      fixture.detectChanges();

      const panel = fixture.debugElement.query(By.css('app-phone-leave'));
      expect(panel).not.toBeNull();
      expect(panel.componentInstance.presetStudentId()).toBe('stu-1');
      expect(studentGetMock).toHaveBeenCalledWith('stu-1');
    });

    it('代刷到班之後只講到班時間，並從主區移到名冊的「到」', async () => {
      await board({ workbenchExpected: [expectedStudent()] });
      checkInMock.mockReturnValue(
        of({ id: 'k9', studentId: 'stu-1', checkedInAt: `${TODAY}T10:01:00` }),
      );
      q('board-action')!.click();
      fixture.detectChanges();

      expect(checkInMock).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: 'stu-1', campusId: 'campus-a' }),
      );
      expect(q('call-row')).toBeNull();
      expect(q('arrived-at')!.textContent).toContain('10:01 到');
      expect(el().textContent).not.toContain('已為');
    });

    it('取消到班：連同打卡一起撤回，回到該到沒到', async () => {
      await board({
        workbenchExpected: [expectedStudent()],
        workbenchArrived: [
          { studentId: 'stu-1', checkedInAt: `${TODAY}T01:00:00Z`, checkinId: 'k1' },
        ],
      });
      cancelMock.mockReturnValue(of(undefined));
      q('cancel-arrival')!.click();
      fixture.detectChanges();

      expect(cancelMock).toHaveBeenCalledWith('k1');
      expect(q('call-row')).not.toBeNull();
    });

    it('到班名冊依最早一堂分章，現在線在第一個還沒開始的章前面', async () => {
      await board({
        workbenchExpected: [
          expectedStudent({ studentId: 'a', studentName: '甲' }),
          expectedStudent({
            studentId: 'b',
            studentName: '乙',
            firstSession: { startTime: '11:00', className: '英文班 B' },
          }),
        ],
        workbenchArrived: [{ studentId: 'a', checkedInAt: `${TODAY}T01:00:00Z`, checkinId: 'k1' }],
      });

      const chapters = qa('roster-chapter');
      expect(chapters).toHaveLength(2);
      expect(chapters[0].textContent).toContain('09:00');
      expect(chapters[0].textContent).toContain('到 1／1');
      expect(chapters[1].textContent).toContain('到 0／1');
      expect(q('now-line')!.textContent).toContain('現在 10:00');
      // 現在線在第二章之前
      expect(
        q('now-line')!.compareDocumentPosition(chapters[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(q('coll-roster')!.textContent).toContain('到 1／2 · 請假 0');
    });

    it('逐堂點名模式不渲染「該到沒到」也不渲染名冊', async () => {
      await setup({ mode: 'per_session' });

      expect(q('call-row')).toBeNull();
      expect(q('coll-roster')).toBeNull();
      expect(el().textContent).toContain('今日課表');
    });
  });

  describe('摺疊列與臨時狀況', () => {
    it('今天的請假：每筆有來源與原因', async () => {
      await setup({
        leaves: [
          leave({ id: 'l1', studentName: '林小美', reason: '感冒', submittedByRole: 'parent' }),
          leave({ id: 'l2', studentName: '王小弟', reason: null, submittedByRole: 'admin' }),
        ],
      });

      const items = qa('leave-item').map((i) => i.textContent!.replace(/\s+/g, ' '));
      expect(items[0]).toContain('林小美');
      expect(items[0]).toContain('家長 app · 感冒');
      expect(items[1]).toContain('櫃台');
      expect(q('coll-leaves')!.textContent).toContain('2 筆 · 已登記');
    });

    it('逾期帳單：張數與金額來自伺服器摘要，列表是前幾筆', async () => {
      await setup({
        permissions: ['manage_finance'],
        overdue: { count: 9, amount: 81050 },
      });

      expect(q('coll-overdue')!.textContent).toContain('9 張 · NT$ 81,050');
      const item = q('overdue-item')!;
      expect(item.textContent).toContain('黃小華');
      expect(item.textContent).toContain('4,000'); // 5000 − 1000
      expect(invoiceListMock).toHaveBeenCalledWith({ overdue: true, pageSize: 4 });
    });

    it('沒有 manage_finance → 不打帳單端點、不出現逾期帳單', async () => {
      await setup({ permissions: ['view_reports'] });

      expect(summaryMock).not.toHaveBeenCalled();
      expect(q('coll-overdue')).toBeNull();
    });

    it('臨時狀況三個入口都連到課表頁', async () => {
      await setup();

      const links = qa('emergency-link');
      expect(links.map((l) => l.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        expect.stringContaining('颱風、停電'),
        expect.stringContaining('老師請假'),
        expect.stringContaining('班級改時段'),
      ]);
      for (const link of links) {
        expect(link.getAttribute('href')).toBe(RoutesCatalog.ADMIN_SESSIONS.absolutePath);
      }
    });
  });

  it('載入中不得宣稱今日尚無排課', async () => {
    await setup({ pending: true });

    const text = el().textContent as string;
    expect(text).not.toContain('今日尚無排課');
    expect(text).not.toContain('今天沒有人請假');
    expect(el().querySelector('.skeleton-bar')).not.toBeNull();
  });

  it('今天沒課時顯示空狀態', async () => {
    await setup({ todaySessions: [] });

    expect(el().textContent).toContain('今日尚無排課');
  });

  it('不再有寫死的佔位卡', async () => {
    await setup();

    const text = el().textContent as string;
    expect(text).not.toContain('資料串接中');
  });

  /**
   * #964：接到電話就地請假。任務流本身在 `phone-leave.component.spec.ts`；
   * 這裡守儀表板的兩件事：入口給誰、送出之後底下的看板有沒有跟著更新（閉環在同一頁）。
   * #1314 D：入口改名「登記請假」，進工具列／手機托盤的主要行動。
   */
  describe('登記請假（#964）', () => {
    const entry = () =>
      Array.from(el().querySelectorAll<HTMLElement>('app-page-actions p-button')).find((b) =>
        b.textContent?.includes('登記請假'),
      );

    it('沒有請假寫入權限（basic_operations）的人看不到入口', async () => {
      await setup({ permissions: ['view_reports'] });
      expect(entry()).toBeUndefined();
      expect(el().querySelector('app-page-actions')).toBeNull();
    });

    it('有權限 → 工具列有「登記請假」與「櫃台代刷到班」', async () => {
      await setup({ permissions: ['view_reports', 'basic_operations'] });
      expect(entry()).toBeDefined();
      expect(el().querySelector('app-page-actions')!.textContent).toContain('櫃台代刷到班');
    });

    it('送出成功後重抓「今日」—— 剛登記的假出現在底下的看板上', async () => {
      await setup({ permissions: ['view_reports', 'basic_operations'] });
      component['openPhoneLeave']();
      fixture.detectChanges();

      const before = {
        workbench: workbenchMock.mock.calls.length,
        leaves: leavesMock.mock.calls.length,
      };
      const panel = fixture.debugElement.query(By.css('app-phone-leave'));
      expect(panel).not.toBeNull();
      panel.componentInstance.completed.emit();

      expect(workbenchMock.mock.calls.length).toBe(before.workbench + 1);
      expect(leavesMock.mock.calls.length).toBe(before.leaves + 1);
    });
  });
});
