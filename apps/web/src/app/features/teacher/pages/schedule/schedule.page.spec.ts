import { signal } from '@angular/core';
import { format, startOfWeek } from 'date-fns';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AttendanceService } from '@core/attendance.service';
import { ContactBookService } from '@core/contact-book.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SchedulePage } from './schedule.page';

const MONDAY_THIS_WEEK = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

const ORG = {
  id: 'org-1',
  name: 'Clessia Demo',
  attendanceMode: 'per_session' as const,
  attendanceResponsible: 'admin' as const,
  attendanceRetroactiveDays: 0,
};

describe('SchedulePage', () => {
  let component: SchedulePage;
  let fixture: ComponentFixture<SchedulePage>;
  let sessionsSpy: ReturnType<typeof vi.fn>;
  let missingSummarySpy: ReturnType<typeof vi.fn>;

  async function setup(
    options: {
      missingSummaryFails?: boolean;
      sessionsFails?: boolean;
      orgSettingsFails?: boolean;
      attendanceResponsible?: 'admin' | 'teacher';
      sessions?: unknown[];
    } = {},
  ) {
    const orgSettings = signal({
      ...ORG,
      attendanceResponsible: options.attendanceResponsible ?? 'admin',
    });
    sessionsSpy = vi.fn(() =>
      options.sessionsFails
        ? throwError(() => new Error('boom'))
        : of({
            data: options.sessions ?? [],
            meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
          }),
    );
    missingSummarySpy = vi.fn(() =>
      options.missingSummaryFails
        ? throwError(() => new Error('boom'))
        : of({
            data: [
              { date: '2026-08-31', missingCount: 3 },
              { date: '2026-09-01', missingCount: 0 },
            ],
            meta: { total: 3 },
          }),
    );

    await TestBed.configureTestingModule({
      imports: [SchedulePage],
      providers: [
        { provide: AttendanceService, useValue: { sessions: sessionsSpy } },
        { provide: ContactBookService, useValue: { missingSummary: missingSummarySpy } },
        {
          provide: OrgSettingsService,
          // settings 在真的服務裡是 signal —— mock 成純物件的話，
          // 任何呼叫 settings() 的路徑都會炸，而且是在測試裡才炸
          useValue: {
            settings: orgSettings,
            status: signal(options.orgSettingsFails ? ('failed' as const) : ('ready' as const)),
            getSettings: () => of(orgSettings()),
            load: vi.fn(),
          },
        },
        { provide: OverlayContainerService, useValue: { getContainer: () => null } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchedulePage);
    fixture.componentRef.setInput('page', {
      label: '課表',
      relativePath: 'schedule',
      absolutePath: '/teacher/schedule',
      role: 'teacher',
      icon: 'pi pi-calendar',
      showInMenu: true,
    });
    fixture.detectChanges();
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  it('should create', async () => {
    await setup();
    expect(component).toBeTruthy();
  });

  /**
   * 這條釘住的是一個會靜靜壞掉的東西：後端預設**不回** `cancelled`，
   * 所以少傳 `statuses` 的話停課永遠不會出現，而畫面上看起來只是「那天沒課」。
   */
  it('明式要 cancelled —— 不然停課的課堂永遠不會出現', async () => {
    await setup();
    expect(sessionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: expect.arrayContaining(['cancelled']) }),
    );
  });

  it('聯絡簿待辦跟課表查同一個區間', async () => {
    await setup();
    const [dateFrom, dateTo] = missingSummarySpy.mock.calls[0];
    const sessionArgs = sessionsSpy.mock.calls[0][0] as { dateFrom: string; dateTo: string };
    expect(dateFrom).toBe(sessionArgs.dateFrom);
    expect(dateTo).toBe(sessionArgs.dateTo);
  });

  it('待辦數字照日期對進去', async () => {
    await setup();
    expect(component['missingOn']('2026-08-31')).toBe(3);
    expect(component['missingOn']('2026-09-01')).toBe(0);
  });

  /**
   * 聯絡簿那支掛掉不該讓課表跟著空掉 —— 它們是兩件事，所以各自訂閱。
   * 徽章消失（回 0）而不是顯示錯的數字。
   */
  it('聯絡簿彙總失敗時課表照樣載入，徽章不出現', async () => {
    await setup({ missingSummaryFails: true });
    expect(sessionsSpy).toHaveBeenCalled();
    expect(component['missingOn']('2026-08-31')).toBe(0);
  });

  /**
   * 2026-09-02 UX 審查（阻斷級 A3）：`attendance_responsible = 'admin'` 時老師的課表
   * 沒有任何點名入口，卻仍把過去沒點的課標成「漏點名」—— 對老師問責一件他做不到的事。
   */
  describe('行政負責點名時不問責老師', () => {
    const PAST_UNTAKEN = [
      {
        sessionId: 's1',
        eventId: 'e1',
        status: 'scheduled',
        isSubstitute: false,
        examCount: 0,
        classId: 'c1',
        className: '數學班 A',
        courseName: null,
        teacherName: null,
        campusId: null,
        campusName: null,
        // 本週一 —— 週起始是週一，所以它必定 <= 今天；配上 00:01 的結束時間，
        // 任何時候跑這個測試它都已經「上完了」。用不在本週的日期不行：
        // sessionsByDay 只收本週七天，別的日期會被靜靜丟掉。
        eventDate: MONDAY_THIS_WEEK,
        startTime: '00:00',
        endTime: '00:01',
        enrolledCount: 8,
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
        takenAt: null,
      },
    ];

    it('admin 模式：顯示中性的「未點名」，不出現「漏點名」', async () => {
      await setup({ attendanceResponsible: 'admin', sessions: PAST_UNTAKEN });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('未點名');
      expect(text).not.toContain('漏點名');
      expect(text).not.toContain('堂待點名');
    });

    it('teacher 模式：同一堂課才叫「漏點名」', async () => {
      await setup({ attendanceResponsible: 'teacher', sessions: PAST_UNTAKEN });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('漏點名');
      expect(text).toContain('堂待點名');
    });
  });

  /**
   * 桌機的週條（2026-09-02 使用者推翻七欄之後的新結構）。
   * 它讀的是已經載入的那一週，**不該產生額外請求** —— 課表本來就一次抓七天。
   */
  describe('週條', () => {
    it('七天都在，且不多打一支 API', async () => {
      await setup();
      const days = fixture.nativeElement.querySelectorAll('.schedule-page__weekbar-day');
      expect(days.length).toBe(7);
      expect(sessionsSpy).toHaveBeenCalledTimes(1);
    });

    it('今天那一格標成 aria-current', async () => {
      await setup();
      const current = fixture.nativeElement.querySelectorAll('[aria-current="date"]');
      expect(current.length).toBe(1);
    });

    it('沒有課的那天不畫狀態點', async () => {
      await setup();
      // 預設 sessions 是空的 → 七天都沒課
      expect(fixture.nativeElement.querySelectorAll('.status-dot').length).toBe(0);
      expect(fixture.nativeElement.querySelectorAll('.schedule-page__weekbar-empty').length).toBe(7);
    });
  });
  describe('載入失敗要產生訊號（#484 H1／H3）', () => {
    it('課表查失敗顯示「查詢失敗」，而不是七次「沒有課」', async () => {
      await setup({ sessionsFails: true });
      const text = fixture.nativeElement.textContent;

      expect(text).toContain('查詢失敗');
      // 軌道整個藏起來 —— 不藏的話七天的 `@empty` 各印一次「沒有課」，
      // 而那跟真的沒有排課一模一樣
      expect(fixture.nativeElement.querySelector('.schedule-page__track').hidden).toBe(true);
    });

    it('換週查失敗不留上一週的資料 —— 舊資料配新標題比空畫面危險', async () => {
      await setup({
        sessions: [
          {
            sessionId: 's1',
            eventId: 'e1',
            className: '數學班',
            eventDate: MONDAY_THIS_WEEK,
            startTime: '09:00',
            endTime: '10:00',
            status: 'scheduled',
            takenAt: null,
          },
        ],
      });
      expect(fixture.nativeElement.textContent).toContain('數學班');

      sessionsSpy.mockImplementation(() => throwError(() => new Error('boom')));
      (component as unknown as { nextWeek: () => void }).nextWeek();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('數學班');
      expect(fixture.nativeElement.textContent).toContain('查詢失敗');
    });

    it('重試成功後失敗訊息要消失 —— 旗標不清會一直喊失敗', async () => {
      await setup({ sessionsFails: true });
      expect(fixture.nativeElement.textContent).toContain('查詢失敗');

      sessionsSpy.mockImplementation(() =>
        of({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 } }),
      );
      (component as unknown as { nextWeek: () => void }).nextWeek();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('查詢失敗');
    });

    it('聯絡簿彙總失敗要講出來 —— 沒有徽章會被讀成「都寫完了」', async () => {
      await setup({ missingSummaryFails: true });
      expect(fixture.nativeElement.textContent).toContain('聯絡簿待辦數字暫時讀不到');
    });

    it('聯絡簿彙總成功時不出現那句話', async () => {
      await setup();
      expect(fixture.nativeElement.textContent).not.toContain('聯絡簿待辦數字暫時讀不到');
    });
  });
  describe('點名設定讀不到要講出來（#484 H2）', () => {
    it('設定載入失敗時說明「漏點名」提醒可能不準', async () => {
      await setup({ orgSettingsFails: true });
      expect(fixture.nativeElement.textContent).toContain('讀不到點名設定');
    });

    it('設定載到了就不出現那句話', async () => {
      await setup();
      expect(fixture.nativeElement.textContent).not.toContain('讀不到點名設定');
    });

    it('課表本身失敗時優先講課表 —— 設定的警告不蓋掉它', async () => {
      await setup({ sessionsFails: true, orgSettingsFails: true });
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('查詢失敗');
      expect(text).not.toContain('讀不到點名設定');
    });
  });
});
