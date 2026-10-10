import { signal } from '@angular/core';
import { format, startOfWeek } from 'date-fns';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, vi } from 'vitest';
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
      sessionsStall?: boolean;
      orgSettingsFails?: boolean;
      attendanceResponsible?: 'admin' | 'teacher';
      sessions?: unknown[];
      /** 這些 fixture 放在本週一；單日清單只畫選中日，所以要先點那一天（結果不是意圖） */
      selectDate?: string;
    } = {},
  ) {
    const orgSettings = signal({
      ...ORG,
      attendanceResponsible: options.attendanceResponsible ?? 'admin',
    });
    sessionsSpy = vi.fn(() =>
      options.sessionsStall
        ? NEVER
        : options.sessionsFails
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
    if (options.selectDate) {
      (component as unknown as { selectDay: (d: string) => void }).selectDay(options.selectDate);
      fixture.detectChanges();
    }
  }

  it('should create', async () => {
    await setup();
    expect(component).toBeTruthy();
  });

  // #508：載入中原本整塊被一行文字取代，連帶把整條週條藏起來。改成骨架週條後
  // 這裡改斷言骨架元素，不是文字。7 格對齊 &__weekbar-days 既有的 7 欄 grid。
  it('載入中顯示骨架週條，不是整塊被文字取代', async () => {
    await setup({ sessionsStall: true });

    const skeletons = fixture.nativeElement.querySelectorAll(
      '.schedule-page__weekbar-skeleton.p-skeleton',
    );
    expect(skeletons.length).toBe(7);
    expect(fixture.nativeElement.querySelector('.schedule-page__weekbar')).not.toBeNull();
  });

  /**
   * **#800**：上面那條的骨架掛在 `&__weekbar` 上，而週條是桌機專屬
   * （`display: none` 到 `@container shell-content (min-width: 640px)`）——
   * 所以 390px 下**唯一的載入訊號是 `display: none`**，畫面上就是七行「沒有課」。
   *
   * jsdom 沒有 layout，量不到 container query；**能量到的是根因本身** ——
   * 載入訊號不准掛在那個桌機專屬容器裡面。
   */
  it('載入骨架不在桌機專屬的週條裡 —— 390 下也要有訊號', async () => {
    await setup({ sessionsStall: true });

    expect(fixture.nativeElement.querySelector('.schedule-page__day-skeleton')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.schedule-page__weekbar .schedule-page__day-skeleton'),
    ).toBeNull();
  });

  // 骨架只蓋住週條的話，日清單那半在載入中照樣印七次「沒有課」——1024 也一樣
  it('載入中不渲染軌道，畫面上沒有「沒有課」', async () => {
    await setup({ sessionsStall: true });

    expect(fixture.nativeElement.textContent).not.toContain('沒有課');
    expect(fixture.nativeElement.querySelector('.schedule-page__track')).toBeNull();
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
      await setup({
        attendanceResponsible: 'admin',
        sessions: PAST_UNTAKEN,
        selectDate: MONDAY_THIS_WEEK,
      });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('未點名');
      expect(text).not.toContain('漏點名');
      expect(text).not.toContain('堂待點名');
    });

    it('teacher 模式：同一堂課才叫「漏點名」', async () => {
      await setup({
        attendanceResponsible: 'teacher',
        sessions: PAST_UNTAKEN,
        selectDate: MONDAY_THIS_WEEK,
      });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('漏點名');
      expect(text).toContain('堂待點名');
    });

    // #920：行政負責時老師沒有點名入口，但要能唯讀看自己課堂的名單（rules/attendance-rules.md）
    it('admin 模式：有「看名單」、沒有「開始點名」', async () => {
      await setup({
        attendanceResponsible: 'admin',
        sessions: PAST_UNTAKEN,
        selectDate: MONDAY_THIS_WEEK,
      });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('看名單');
      expect(text).not.toContain('開始點名');
    });

    it('teacher 模式：有「開始點名」、沒有「看名單」', async () => {
      await setup({
        attendanceResponsible: 'teacher',
        sessions: PAST_UNTAKEN,
        selectDate: MONDAY_THIS_WEEK,
      });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('開始點名');
      expect(text).not.toContain('看名單');
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
      expect(fixture.nativeElement.querySelectorAll('.schedule-page__weekbar-empty').length).toBe(
        7,
      );
    });
  });
  /**
   * #1314 TS1：單日清單取代七天軌道。斷言**畫面上有什麼**，不斷言某個 signal。
   * 假時鐘固定在今天中午，「接下來」才不會隨跑測試的時間漂。
   */
  describe('單日清單與「接下來那堂」（#1314 TS1）', () => {
    const TODAY = format(new Date(), 'yyyy-MM-dd');
    const row = (over: Record<string, unknown>) => ({
      sessionId: 'x',
      eventId: 'e',
      status: 'scheduled',
      isSubstitute: false,
      examCount: 0,
      usesContactBook: false,
      classId: 'c',
      className: '班',
      courseName: null,
      teacherName: null,
      campusId: null,
      campusName: null,
      eventDate: TODAY,
      startTime: '09:00',
      endTime: '10:00',
      enrolledCount: 5,
      presentCount: 0,
      onLeaveCount: 0,
      absentCount: 0,
      takenAt: null,
      ...over,
    });
    const names = () =>
      [...fixture.nativeElement.querySelectorAll('.schedule-page__session')].map((el) =>
        (el as HTMLElement).querySelector('p:nth-child(2)')?.textContent?.trim(),
      );

    // 時鐘釘在今天中午。**不能用 `vi.useRealTimers()` 收尾**：test:timetravel 的 setup 已經
    // 把時鐘推到未來，收成真時鐘會讓這個 describe 之後的測試全看到「現在」（#670 的形狀）。
    // 所以只還原我們動過的那一層。
    let restore: () => void;
    beforeEach(() => {
      const alreadyFake = vi.isFakeTimers();
      const before = Date.now();
      if (!alreadyFake) vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
      restore = () => (alreadyFake ? vi.setSystemTime(before) : vi.useRealTimers());
    });
    afterEach(() => restore());

    const sessions = () => [
      row({ sessionId: '1', className: '上午班', startTime: '09:00', endTime: '10:00' }),
      row({ sessionId: '2', className: '晚上班', startTime: '19:00', endTime: '21:00' }),
      row({ sessionId: '3', className: '傍晚班', startTime: '16:00', endTime: '17:00' }),
    ];

    it('預設選今天，畫面上只有今天的課（沒有水平軌道）', async () => {
      await setup({
        sessions: [
          ...sessions(),
          row({ sessionId: '9', className: '別天班', eventDate: '2000-01-01' }),
        ],
      });
      expect(fixture.nativeElement.querySelector('.schedule-page__track')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('別天班');
      expect(names().length).toBe(3);
    });

    it('今天：下一堂排第一張並標記，其餘照時間排，而且沒有重複', async () => {
      await setup({ sessions: sessions() });
      // 假時鐘中午 → 上午班已結束，傍晚班是下一堂
      expect(names()).toEqual(['傍晚班', '上午班', '晚上班']);
      const cards = fixture.nativeElement.querySelectorAll('.schedule-page__session');
      expect(cards[0].classList.contains('schedule-page__session--next')).toBe(true);
      expect(fixture.nativeElement.querySelectorAll('.schedule-page__session--next').length).toBe(
        1,
      );
    });

    // #1314 TS2：橘面標題是開場句，副行是今天的摘要，週區間搬到週條旁
    it('開場句與副行：下一堂倒數、今天幾堂、本週幾堂', async () => {
      await setup({ sessions: sessions() });
      const open = fixture.nativeElement.querySelector('app-page-open').textContent;
      expect(open).toContain('下一堂 16:00 傍晚班，還有 240 分。');
      expect(open).toContain('今天 3 堂 · 本週 3 堂');
      expect(open).not.toContain('現在：');
    });

    it('上課中：副行寫現在哪個班（分校）', async () => {
      await setup({
        sessions: [
          row({ className: '午間班', campusName: '文山', startTime: '11:30', endTime: '12:30' }),
        ],
      });
      const open = fixture.nativeElement.querySelector('app-page-open').textContent;
      expect(open).toContain('午間班 上課中，還有 30 分下課。');
      expect(open).toContain('現在：午間班（文山）上課中');
    });

    it('讀不到這週（失敗）時退回頁名，不拿空課表說「今天沒有課」', async () => {
      await setup({ sessionsFails: true });
      const open = fixture.nativeElement.querySelector('app-page-open').textContent;
      expect(open).toContain('課表');
      expect(open).not.toContain('今天沒有你的課');
    });

    it('聯絡簿還沒寫：整週加總；查失敗時不印這顆（失敗不是 0）', async () => {
      await setup({ attendanceResponsible: 'teacher' });
      expect(fixture.nativeElement.querySelector('app-page-open').textContent).toContain(
        '則聯絡簿還沒寫',
      );
      expect(component['missingTotal']()).toBe(3);
      fixture.destroy();
      TestBed.resetTestingModule();
      await setup({ attendanceResponsible: 'teacher', missingSummaryFails: true });
      expect(fixture.nativeElement.querySelector('app-page-open').textContent).not.toContain(
        '聯絡簿還沒寫',
      );
    });

    it('週條可以換日：點別天只看到那天，而且沒有「接下來」卡', async () => {
      const mondayLater = format(
        new Date(new Date(`${TODAY}T12:00:00`).getTime() + 86_400_000),
        'yyyy-MM-dd',
      );
      await setup({
        sessions: [
          ...sessions(),
          row({ sessionId: '8', className: '明天班', eventDate: mondayLater }),
        ],
      });
      const days = [...fixture.nativeElement.querySelectorAll('.schedule-page__weekbar-day')];
      const tomorrow = days.find((d) =>
        (d as HTMLElement).textContent?.includes(
          format(new Date(`${mondayLater}T12:00:00`), 'M/d'),
        ),
      ) as HTMLElement | undefined;
      // 今天若是週日，明天在下一週；那種日子這條只驗到「今天」之外沒有東西可點，跳過
      if (!tomorrow) return;
      tomorrow.click();
      fixture.detectChanges();

      expect(names()).toEqual(['明天班']);
      expect(fixture.nativeElement.querySelector('.schedule-page__session--next')).toBeNull();
      expect(tomorrow.getAttribute('aria-pressed')).toBe('true');
    });

    it('這天沒課：說「這天沒有你的課。」', async () => {
      await setup();
      expect(fixture.nativeElement.textContent).toContain('這天沒有你的課。');
    });

    it('換週後選中日回到那週的週一（那週沒有今天）', async () => {
      await setup({ sessions: sessions() });
      (component as unknown as { nextWeek: () => void }).nextWeek();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const selected = fixture.nativeElement.querySelectorAll('[aria-pressed="true"]');
      expect(selected.length).toBe(1);
      expect(selected[0].getAttribute('aria-current')).toBeNull();
    });

    it('聯絡簿缺漏徽章跟著選中日走', async () => {
      await setup({ sessions: sessions() });
      (component as unknown as { missingByDate: { set: (m: Map<string, number>) => void } })[
        'missingByDate'
      ].set(new Map([[TODAY, 4]]));
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('h2 [aria-label="4 位學生的聯絡簿還沒寫"]'),
      ).not.toBeNull();
    });
  });

  describe('載入失敗要產生訊號（#484 H1／H3）', () => {
    /**
     * **#800**：這條原本斷言 `.schedule-page__track` 的 `hidden` 屬性是 true，
     * 而它一直是綠的 —— **但畫面上那塊東西看得見**：`[hidden]` 只設了屬性，
     * `.schedule-page__track { display: grid }` 是 author 樣式，永遠蓋過 UA 的
     * `[hidden] { display: none }`（跟 specificity 無關，是階層順序）。
     * 於是錯誤畫面是「查詢失敗」＋七行「沒有課」照樣佔滿版面 —— 正好是這條
     * 測試以為自己擋掉的東西。
     *
     * **改成斷言使用者看得到的東西**：軌道不渲染、畫面上沒有「沒有課」。
     */
    it('課表查失敗不渲染軌道，畫面上沒有七次「沒有課」', async () => {
      await setup({ sessionsFails: true });
      const text = fixture.nativeElement.textContent;

      expect(text).toContain('載入失敗');
      expect(text).not.toContain('沒有課');
      expect(fixture.nativeElement.querySelector('.schedule-page__track')).toBeNull();
    });

    /**
     * 錯誤態的錨點會印「0 堂待點名／本週 0 堂」，跟「真的沒課」一模一樣 ——
     * 跟七行「沒有課」同一個後果（#800）。
     *
     * 斷言元素不存在而不是文字不含「本週」：`app-load-failed` 的 description
     * 自己就有「本週」兩個字（**第一版這條就是這樣誤紅的**）。
     */
    it('課表查失敗時不印本週堂數錨點', async () => {
      await setup({ sessionsFails: true });

      expect(fixture.nativeElement.querySelector('app-band-anchor')).toBeNull();
    });

    it('錯誤態的重試會重新取數', async () => {
      await setup({ sessionsFails: true });
      const callsBefore = sessionsSpy.mock.calls.length;

      fixture.nativeElement.querySelector('app-load-failed button').click();
      fixture.detectChanges();

      expect(sessionsSpy.mock.calls.length).toBe(callsBefore + 1);
    });

    it('換週查失敗不留上一週的資料 —— 舊資料配新標題比空畫面危險', async () => {
      await setup({
        selectDate: MONDAY_THIS_WEEK,
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
      expect(fixture.nativeElement.textContent).toContain('載入失敗');
    });

    it('重試成功後失敗訊息要消失 —— 旗標不清會一直喊失敗', async () => {
      await setup({ sessionsFails: true });
      expect(fixture.nativeElement.textContent).toContain('載入失敗');

      sessionsSpy.mockImplementation(() =>
        of({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 } }),
      );
      (component as unknown as { nextWeek: () => void }).nextWeek();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('載入失敗');
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
      expect(text).toContain('載入失敗');
      expect(text).not.toContain('讀不到點名設定');
    });
  });
});
