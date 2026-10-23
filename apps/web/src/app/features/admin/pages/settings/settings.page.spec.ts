import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { OrgSettingsService, type OrgSettings } from '@core/org-settings.service';
import { BillingPeriodsService } from '@core/billing-periods.service';
import { SystemClockService } from '@core/system-clock.service';
import { provideRouter } from '@angular/router';
import { AuthService } from '@core/auth.service';
import { GradePromotionsService } from '@core/grade-promotions.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';

import { SettingsPage } from './settings.page';

const DAILY_CHECKIN: OrgSettings = {
  id: 'org-1',
  name: 'Clessia Demo',
  attendanceMode: 'daily_checkin',
  attendanceResponsible: 'admin',
  attendanceRetroactiveDays: 0,
  gradePromotionMonthDay: '09-01',
  gradePromotionReminderDays: 7,
  applicationReviewDays: 3,
  trialFollowupDays: 1,
};

describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;

  const orgSettingsServiceMock = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  const billingPeriodsMock = { list: vi.fn(), create: vi.fn() };
  let permissions: string[] = [];
  // 同 AuthService.hasPermission：`*` 什麼都有
  const authMock = {
    hasPermission: (p: string) => permissions.includes(p) || permissions.includes('*'),
  };
  const gradePromotionsMock = { history: vi.fn(), revert: vi.fn() };

  /** ngOnInit 在第一次 `detectChanges()` 跑，所以取數的結果要在建立元件之前就決定 */
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        MessageService,
        provideRouter([]),
        { provide: OrgSettingsService, useValue: orgSettingsServiceMock },
        { provide: BillingPeriodsService, useValue: billingPeriodsMock },
        { provide: AuthService, useValue: authMock },
        { provide: GradePromotionsService, useValue: gradePromotionsMock },
        { provide: SystemClockService, useValue: { todayTaipei: () => '2026-10-23' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', {
      label: 'Test',
      relativePath: '',
      absolutePath: '',
      role: undefined,
      icon: '',
      showInMenu: true,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const bodyText = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    vi.clearAllMocks();
    orgSettingsServiceMock.getSettings.mockReturnValue(of(DAILY_CHECKIN));
    orgSettingsServiceMock.updateSettings.mockReturnValue(of(DAILY_CHECKIN));
    billingPeriodsMock.list.mockReturnValue(of({ data: [] }));
    permissions = [];
    gradePromotionsMock.history.mockReturnValue(of({ data: [] }));
  });

  describe('學年升級段（#1820）', () => {
    const buttonLabels = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map(
        (b) => b.textContent?.trim() ?? '',
      );
    const LAST = {
      id: 'gp-1',
      academicYear: 115,
      // 台北 9/1 凌晨 1 點 —— UTC 還是 8/31，日期要照台北寫
      executedAt: '2026-08-31T17:00:00Z',
      revertedAt: null,
      revertible: true,
      studentCount: 42,
    };

    it('摘要寫生效值：升級日與提醒天數', async () => {
      await setup();

      expect(bodyText()).toContain('每年 9/1 · 前 7 天提醒');
    });

    it('提醒 0 天時摘要寫「不提醒」', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(
        of({ ...DAILY_CHECKIN, gradePromotionMonthDay: '08-15', gradePromotionReminderDays: 0 }),
      );
      await setup();

      expect(bodyText()).toContain('每年 8/15 · 不提醒');
    });

    /** 裁定 E：只管部分分校的管理員不能代表全機構按，也不該讀紀錄（API 會 403） */
    it('沒有 all_campuses 時不畫「預覽並執行」、也不讀紀錄', async () => {
      permissions = ['manage_students'];
      await setup();

      expect(buttonLabels()).not.toContain('預覽並執行');
      expect(gradePromotionsMock.history).not.toHaveBeenCalled();
    });

    it('manage_students＋all_campuses：畫「預覽並執行」與上次執行、可復原時有復原鈕', async () => {
      permissions = ['manage_students', 'all_campuses'];
      gradePromotionsMock.history.mockReturnValue(of({ data: [LAST] }));
      await setup();

      expect(buttonLabels()).toContain('預覽並執行');
      expect(bodyText()).toContain('上次執行：115 學年，2026/09/01');
      expect(buttonLabels()).toContain('復原上次升級');
    });

    it('超過 30 天的不給復原鈕，並寫出原因', async () => {
      permissions = ['*'];
      gradePromotionsMock.history.mockReturnValue(of({ data: [{ ...LAST, revertible: false }] }));
      await setup();

      expect(buttonLabels()).not.toContain('復原上次升級');
      expect(bodyText()).toContain('超過 30 天，不能復原');
    });

    it('升級日「9/1」存成 09-01，連同提醒天數一起送', async () => {
      await setup();
      component['gradePromotionDayValue'] = '9/1';
      component['gradePromotionReminderDaysValue'] = 10;

      component['saveGradePromotion']();

      expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({
        gradePromotionMonthDay: '09-01',
        gradePromotionReminderDays: 10,
      });
    });

    it.each(['2/30', '13/1', '0/5', '九月一日', ''])('升級日「%s」不是日期：不送出', async (v) => {
      await setup();
      component['gradePromotionDayValue'] = v;

      component['saveGradePromotion']();

      expect(component['pendingGradePromotionDay']()).toBeNull();
      expect(orgSettingsServiceMock.updateSettings).not.toHaveBeenCalled();
    });

    it('2/29 算合法（閏年才有那天）', async () => {
      await setup();
      component['gradePromotionDayValue'] = '2/29';

      expect(component['pendingGradePromotionDay']()).toBe('02-29');
    });

    /** 二讀：確認框回 false（取消）不能 revert；回 true 才 revert */
    it.each([
      [false, 0],
      [true, 1],
    ])('復原確認框回 %s → revert 呼叫 %i 次', async (answer, times) => {
      permissions = ['manage_students', 'all_campuses'];
      gradePromotionsMock.history.mockReturnValue(of({ data: [LAST] }));
      gradePromotionsMock.revert.mockReturnValue(of({ revertedCount: 1, skipped: [] }));
      await setup();
      const dialog = (component as unknown as { dialogService: DialogService }).dialogService;
      vi.spyOn(dialog, 'open').mockReturnValue({
        onClose: of(answer),
      } as unknown as DynamicDialogRef);

      component['confirmRevert'](LAST);

      expect(gradePromotionsMock.revert).toHaveBeenCalledTimes(times);
    });

    /** 二讀：對話框回 true（有執行）才重讀紀錄，回 false 不讀 */
    it.each([
      [true, 2],
      [false, 1],
    ])('升級對話框關閉回 %s → 紀錄讀 %i 次', async (executed, times) => {
      permissions = ['manage_students', 'all_campuses'];
      await setup();
      const dialog = (component as unknown as { dialogService: DialogService }).dialogService;
      vi.spyOn(dialog, 'open').mockReturnValue({
        onClose: of(executed),
      } as unknown as DynamicDialogRef);

      component['openGradePromotion']();

      expect(gradePromotionsMock.history).toHaveBeenCalledTimes(times);
    });

    /** 設計稿 §3：跳過的名單是行政接下來的工作，要留在段內，不跟著 toast 消失 */
    it('復原完列出被跳過的學生，並重讀紀錄', async () => {
      permissions = ['manage_students', 'all_campuses'];
      gradePromotionsMock.history.mockReturnValue(of({ data: [LAST] }));
      gradePromotionsMock.revert.mockReturnValue(
        of({ revertedCount: 40, skipped: [{ studentId: 's-1', name: '王小明' }] }),
      );
      await setup();

      component['revert']('gp-1');
      fixture.detectChanges();

      expect(gradePromotionsMock.revert).toHaveBeenCalledWith('gp-1');
      expect(bodyText()).toContain('已復原 40 位學生');
      expect(bodyText()).toContain('王小明');
      expect(gradePromotionsMock.history).toHaveBeenCalledTimes(2);
    });
  });

  it('should create', async () => {
    await setup();

    expect(component).toBeTruthy();
  });

  it('取數成功時渲染表單，選中的是讀回來的值', async () => {
    await setup();

    expect(bodyText()).toContain('出勤紀錄模式');
    expect(component['attendanceModeValue']).toBe('daily_checkin');
  });

  /**
   * **#805：取數失敗時不能渲染一個沒讀到的值。**
   * 原本失敗只關掉 `loading`，模板走 `@else` 把表單畫出來，
   * `attendanceModeValue` 停在硬編碼的 `'per_session'` —— 一間實際設定為
   * `daily_checkin` 的補習班會看到「隨堂點名」被選中。
   * 斷言**畫面主體**而不是某個 signal，因為使用者看到的是畫面。
   */
  it('取數失敗時渲染「載入失敗」，不渲染出勤模式表單', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValue(throwError(() => new Error('boom')));

    await setup();

    expect(bodyText()).toContain('載入失敗');
    expect(bodyText()).not.toContain('出勤紀錄模式');
  });

  /**
   * 這一條是 #805 真正的危害：**存回去會靜靜改掉出勤模式**，
   * 而那個設定決定老師端有沒有點名入口、出勤紀錄怎麼產生。
   * 沒有渲染出來的按鈕按不到 —— 所以斷言的是「按鈕不存在」。
   */
  it('取數失敗時沒有可按的儲存鈕', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValue(throwError(() => new Error('boom')));

    await setup();

    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(buttons.some((b) => b.textContent?.includes('儲存'))).toBe(false);
  });

  it('重試會重新取數，成功後表單就回來了', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValueOnce(throwError(() => new Error('boom')));

    await setup();
    expect(bodyText()).toContain('載入失敗');

    component['loadSettings']();
    fixture.detectChanges();

    expect(orgSettingsServiceMock.getSettings).toHaveBeenCalledTimes(2);
    expect(bodyText()).toContain('出勤紀錄模式');
    expect(bodyText()).not.toContain('載入失敗');
  });

  // #920：API 早就收 attendanceResponsible，之前只缺 UI —— 老師端整層點名／日誌／聯絡簿只能靠改 DB 打開
  describe('誰負責點名', () => {
    it('選中的是讀回來的值', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(
        of({ ...DAILY_CHECKIN, attendanceResponsible: 'teacher' }),
      );
      await setup();

      expect(bodyText()).toContain('誰負責點名');
      expect(component['attendanceResponsibleValue']).toBe('teacher');
    });

    it('儲存只送 attendanceResponsible，不夾帶出勤模式', async () => {
      await setup();
      component['attendanceResponsibleValue'] = 'teacher';

      component['saveAttendanceResponsible']();

      expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({
        attendanceResponsible: 'teacher',
      });
    });

    it('取數失敗時這一段也不渲染（不能把沒讀到的預設值存回去，#805）', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(throwError(() => new Error('boom')));
      await setup();

      expect(bodyText()).not.toContain('誰負責點名');
    });
  });

  /** #1882：出勤兩段改成可收合的列，跟下面各段一致 */
  describe('出勤兩段收成可收合的列（#1882）', () => {
    const colls = () => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLDetailsElement>(
        'details.settings-page__coll',
      ),
    ];
    const summaryOf = (title: string) =>
      colls()
        .find((d) => d.querySelector('summary')?.textContent?.includes(title))
        ?.querySelector('summary');
    const summaryText = (title: string) => {
      const el = summaryOf(title);
      return el
        ? [...el.children].map((c) => c.textContent?.replace(/\s+/g, ' ').trim()).join(' ')
        : undefined;
    };

    it('出勤紀錄模式、誰負責點名排最前面，全部預設收起；摘要寫存著的值', async () => {
      await setup();

      const titles = colls().map((d) => d.querySelector('summary span')?.textContent?.trim());
      expect(titles.slice(0, 2)).toEqual(['出勤紀錄模式', '誰負責點名']);
      expect(colls().every((d) => !d.open)).toBe(true);
      expect(summaryText('出勤紀錄模式')).toBe('出勤紀錄模式 日到班');
      expect(summaryText('誰負責點名')).toBe('誰負責點名 行政負責');
    });

    // 收起來之後分段鈕旁邊沒有可見標題，讀屏靠 aria-labelledby 指回列標題
    it('兩組分段鈕的 aria-labelledby 指到各自的列標題', async () => {
      await setup();
      const root = fixture.nativeElement as HTMLElement;
      const labelOf = (title: string) => {
        const row = colls().find((d) => d.querySelector('summary')?.textContent?.includes(title))!;
        const ids = row
          .querySelector('[aria-labelledby]')!
          .getAttribute('aria-labelledby')!
          .split(/\s+/);
        return ids.map((id) => root.querySelector(`#${id}`)?.textContent?.trim());
      };
      expect(labelOf('出勤紀錄模式')).toContain('出勤紀錄模式');
      expect(labelOf('誰負責點名')).toContain('誰負責點名');
    });

    it('還沒按儲存的選擇不改摘要；儲存成功後摘要跟著改', async () => {
      await setup();
      orgSettingsServiceMock.updateSettings.mockReturnValue(
        of({ ...DAILY_CHECKIN, attendanceMode: 'per_session', attendanceResponsible: 'teacher' }),
      );

      component['attendanceModeValue'] = 'per_session';
      fixture.detectChanges();
      expect(summaryText('出勤紀錄模式')).toBe('出勤紀錄模式 日到班');

      component['saveAttendanceMode']();
      component['attendanceResponsibleValue'] = 'teacher';
      component['saveAttendanceResponsible']();
      fixture.detectChanges();
      expect(summaryText('出勤紀錄模式')).toBe('出勤紀錄模式 隨堂點名');
      expect(summaryText('誰負責點名')).toBe('誰負責點名 老師負責');
    });

    it('儲存失敗：分段鈕退回存著的值、按鈕不再轉圈、出錯誤提示；摘要不變', async () => {
      await setup();
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      orgSettingsServiceMock.updateSettings.mockReturnValue(throwError(() => new Error('boom')));

      component['attendanceModeValue'] = 'per_session';
      component['saveAttendanceMode']();
      component['attendanceResponsibleValue'] = 'teacher';
      component['saveAttendanceResponsible']();
      fixture.detectChanges();

      expect(component['attendanceModeValue']).toBe('daily_checkin');
      expect(component['attendanceResponsibleValue']).toBe('admin');
      expect(component['saving']()).toBe(false);
      expect(component['savingResponsible']()).toBe(false);
      expect(toast).toHaveBeenCalledTimes(2);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
      expect(summaryText('出勤紀錄模式')).toBe('出勤紀錄模式 日到班');
      expect(summaryText('誰負責點名')).toBe('誰負責點名 行政負責');
    });
  });

  /**
   * #1073：補習班帳戶資訊（家長待付款頁要看）。它是財務設定 —— API 只回給有
   * `manage_finance` 的人（key 不存在 ≠ null），所以沒有那個 key 就整段不畫：
   * 畫一個讀不到值的空欄位、按下儲存就會把機構的帳戶清掉。
   */
  it('有帳戶資訊這個 key（財務權限）→ 顯示多行欄位，儲存送 paymentInfo', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValue(
      of({ ...DAILY_CHECKIN, paymentInfo: '台銀 004\n帳號 111' }),
    );
    await setup();

    const textarea = (fixture.nativeElement as HTMLElement).querySelector(
      'textarea.settings-page__textarea',
    ) as HTMLTextAreaElement | null;
    expect(bodyText()).toContain('家長付款帳戶資訊');
    expect(textarea?.value).toBe('台銀 004\n帳號 111');

    component['paymentInfoValue'] = '郵局 700';
    component['savePaymentInfo']();

    expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({ paymentInfo: '郵局 700' });
  });

  it('回應裡沒有 paymentInfo（沒有財務權限）→ 不畫帳戶資訊區塊', async () => {
    await setup();

    expect(bodyText()).not.toContain('家長付款帳戶資訊');
  });

  /** #1305：待開單提醒天數 —— 財務設定，同帳戶資訊：沒有這個 key 就整段不畫 */
  it('有 billingReminderDays 這個 key → 顯示，儲存只送 billingReminderDays（沒讀到的欄不寫回）', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValue(
      of({ ...DAILY_CHECKIN, billingReminderDays: 14 }),
    );
    await setup();

    expect(bodyText()).toContain('待開單提醒');
    component['billingReminderDaysValue'] = 7;
    component['saveFinanceBasics']();

    expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({ billingReminderDays: 7 });
  });

  it('回應裡沒有 billingReminderDays（沒有財務權限）→ 不畫', async () => {
    await setup();

    expect(bodyText()).not.toContain('待開單提醒');
  });

  /** #1732：連續請假可不收費的門檻 —— 財務設定，同上 */
  it('有 leaveWaiverDays 這個 key → 顯示，儲存送 leaveWaiverDays', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValue(
      of({ ...DAILY_CHECKIN, leaveWaiverDays: 3 }),
    );
    await setup();

    expect(bodyText()).toContain('連續請假可不收費');
    component['leaveWaiverDaysValue'] = 5;
    component['saveFinanceBasics']();

    expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({ leaveWaiverDays: 5 });
  });

  it('leaveWaiverDays 儲存失敗：跳錯誤、按鈕不再 loading', async () => {
    orgSettingsServiceMock.getSettings.mockReturnValue(
      of({ ...DAILY_CHECKIN, leaveWaiverDays: 3 }),
    );
    orgSettingsServiceMock.updateSettings.mockReturnValue(throwError(() => new Error('boom')));
    await setup();
    const add = vi.spyOn(TestBed.inject(MessageService), 'add');
    component['saveFinanceBasics']();
    expect(component['savingFinanceBasics']()).toBe(false);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('回應裡沒有 leaveWaiverDays（沒有財務權限）→ 不畫', async () => {
    await setup();

    expect(bodyText()).not.toContain('連續請假可不收費');
  });

  // #1660（#1626 Q2）：家長繳費提醒時間點
  describe('家長繳費提醒（#1660）', () => {
    const WITH_FINANCE: OrgSettings = { ...DAILY_CHECKIN, invoiceReminderOffsets: [-3, 0, 1, 7] };
    type Page = {
      newReminderDirection: 'before' | 'after';
      newReminderDays: number;
      addReminderOffset: () => void;
      removeReminderOffset: (o: number) => void;
      saveReminderOffsets: () => void;
      pendingReminderOffset: () => number | null;
      reminderOffsets: () => number[];
      savingReminderOffsets: () => boolean;
    };
    const page = () => component as unknown as Page;

    it('加入比現有值小的天數：清單照時間排序，畫面上「到期前 10 天」在「到期前 3 天」前面', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(WITH_FINANCE));
      await setup();
      page().newReminderDirection = 'before';
      page().newReminderDays = 10;
      page().addReminderOffset();
      expect(page().reminderOffsets()).toEqual([-10, -3, 0, 1, 7]);
      fixture.detectChanges();
      // 只看提醒清單本身 —— 收合段的摘要（#1314 SE2a）寫的是已存的值，排在清單前面
      const text = (fixture.nativeElement as HTMLElement).querySelector(
        'ul[aria-labelledby="settings-invoice-reminder-title"]',
      )!.textContent!;
      expect(text.indexOf('到期前 10 天')).toBeGreaterThan(-1);
      expect(text.indexOf('到期前 10 天')).toBeLessThan(text.indexOf('到期前 3 天'));
    });

    it('儲存失敗：跳錯誤、按鈕不再 loading（可以再按一次）', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(WITH_FINANCE));
      orgSettingsServiceMock.updateSettings.mockReturnValue(throwError(() => new Error('boom')));
      await setup();
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');
      page().saveReminderOffsets();
      expect(page().savingReminderOffsets()).toBe(false);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('沒有財務權限（回應沒有這個 key）→ 整張卡不畫', async () => {
      await setup();
      expect(bodyText()).not.toContain('家長繳費提醒');
    });

    it('有財務權限：用人話列出時間點', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(WITH_FINANCE));
      await setup();
      expect(bodyText()).toContain('到期前 3 天');
      expect(bodyText()).toContain('到期當天');
      expect(bodyText()).toContain('逾期第 1 天');
      expect(bodyText()).toContain('逾期第 7 天');
      // 新模型：沒開推播的家長也有通知（計畫席 10-16 定的文案）
      expect(bodyText()).toContain('沒開的家長，也會在通知中心看到這則提醒');
      expect(bodyText()).not.toContain('才收得到');
    });

    it('加入「逾期 14 天」、移除「到期當天」，儲存送出排序後的值', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(WITH_FINANCE));
      await setup();
      page().newReminderDirection = 'after';
      page().newReminderDays = 14;
      page().addReminderOffset();
      page().removeReminderOffset(0);
      page().saveReminderOffsets();
      expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({
        invoiceReminderOffsets: [-3, 1, 7, 14],
      });
    });

    it('重複、範圍外、已滿 6 個都加不進去', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(WITH_FINANCE));
      await setup();
      page().newReminderDirection = 'before';
      page().newReminderDays = 3; // 已有 -3
      expect(page().pendingReminderOffset()).toBeNull();
      page().newReminderDays = 31;
      expect(page().pendingReminderOffset()).toBeNull();
      page().newReminderDirection = 'after';
      page().newReminderDays = 0; // 逾期第 0 天不存在（那是「到期當天」）
      expect(page().pendingReminderOffset()).toBeNull();
      page().newReminderDays = 61;
      expect(page().pendingReminderOffset()).toBeNull();

      for (const d of [20, 30]) {
        page().newReminderDays = d;
        page().addReminderOffset();
      }
      expect(page().reminderOffsets()).toHaveLength(6);
      page().newReminderDays = 40;
      expect(page().pendingReminderOffset()).toBeNull();
    });
  });

  // #1314 SE2a：財務設定收成「繳費」段、加「學期與繳費週期」段（A6 general 的 .colls）
  describe('一般分頁的可收合段（#1314 SE2a）', () => {
    const FINANCE: OrgSettings = {
      ...DAILY_CHECKIN,
      invoiceDueDays: 7,
      invoiceReminderOffsets: [-3, 0],
      billingReminderDays: 14,
      leaveWaiverDays: 3,
      paymentInfo: null,
    };
    const period = (id: string, name: string, start: string, end: string) => ({
      id,
      orgId: 'org-1',
      name,
      startDate: start,
      endDate: end,
      createdAt: '',
      updatedAt: '',
      overlappingEnrollmentCount: 0,
    });
    /** 逐個子元素取字再以空白接起來 —— textContent 直接串會把相鄰兩個 span 黏在一起 */
    const byChild = (el: Element) =>
      Array.from(el.children)
        .map((c) => c.textContent?.replace(/\s+/g, ' ').trim())
        .join(' ');
    const summaries = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('summary')).map(byChild);

    it('沒有財務權限（回應沒有財務 key）→ 財務兩段都不畫，也不讀週期；學年升級不是財務，照畫', async () => {
      await setup();
      // 報名流程（#1821）、學年升級（#1820）不是財務設定，照畫
      expect(summaries().slice(2)).toEqual([
        '報名流程 審核 3 天 · 試聽跟進 1 天',
        '學年升級 每年 9/1 · 前 7 天提醒',
      ]);
      expect(billingPeriodsMock.list).not.toHaveBeenCalled();
    });

    it('有財務權限 → 「繳費」摘要寫生效值、「週期」摘要寫幾個', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      billingPeriodsMock.list.mockReturnValue(
        of({ data: [period('p1', '114 上', '2025-09-01', '2026-01-31')] }),
      );
      await setup();
      expect(summaries().slice(2)).toEqual([
        '報名流程 審核 3 天 · 試聽跟進 1 天',
        '繳費 期限 7 天 · 到期前 3 天、到期當天提醒',
        '學期與繳費週期 1 個週期',
        '學年升級 每年 9/1 · 前 7 天提醒',
      ]);
    });

    describe('#1100 #35③ 用模板建立', () => {
      const pick = (key: string) =>
        (component as unknown as { createFromTemplate: (k: string) => void }).createFromTemplate(
          key,
        );

      it('選了直接照下一個學年建（10/23 → 116 學年），同名的略過，建完重讀清單', async () => {
        orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
        billingPeriodsMock.list.mockReturnValue(
          of({ data: [period('p1', '116 上學期', '2027-09-01', '2028-01-31')] }),
        );
        billingPeriodsMock.create.mockImplementation((input) =>
          of({ data: { id: 'n', ...input } }),
        );
        await setup();
        const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
        billingPeriodsMock.list.mockClear();

        pick('two-terms');

        expect(billingPeriodsMock.create.mock.calls.map((c) => c[0])).toEqual([
          { name: '116 下學期', startDate: '2028-02-01', endDate: '2028-06-30' },
        ]);
        expect(toast).toHaveBeenCalledWith({
          severity: 'success',
          summary: '已用「傳統二學期制」建立 1 個週期，日期可以再改',
          detail: '略過 1 個同名的',
        });
        expect(billingPeriodsMock.list).toHaveBeenCalledTimes(1);
      });

      it('建到一半失敗：停在那裡、說可能建了一部分、照樣重讀清單', async () => {
        orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
        billingPeriodsMock.create
          .mockReturnValueOnce(of({ data: { id: 'a' } }))
          .mockReturnValueOnce(throwError(() => new Error('boom')));
        await setup();
        const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
        billingPeriodsMock.list.mockClear();

        pick('terms-and-breaks');

        expect(billingPeriodsMock.create).toHaveBeenCalledTimes(2);
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
        expect(billingPeriodsMock.list).toHaveBeenCalledTimes(1);
      });

      it('全部都已經有了：不建、info toast', async () => {
        orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
        billingPeriodsMock.list.mockReturnValue(
          of({
            data: [
              period('p1', '116 上學期＋暑假', '2027-07-01', '2028-01-31'),
              period('p2', '116 下學期＋寒假', '2028-02-01', '2028-06-30'),
            ],
          }),
        );
        await setup();
        const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
        pick('terms-with-breaks');
        expect(billingPeriodsMock.create).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith({
          severity: 'info',
          summary: '「上學期＋暑假／下學期＋寒假」的週期都已經有了',
        });
      });

      it('下拉在週期段裡（有財務權限才看得到）', async () => {
        orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
        await setup();
        expect(
          (fixture.nativeElement as HTMLElement).querySelector('[data-testid="period-template"]'),
        ).not.toBeNull();
      });
    });

    it('週期列表新到舊，連到費用方案頁管理', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      billingPeriodsMock.list.mockReturnValue(
        of({
          data: [
            period('p1', '114 上', '2025-09-01', '2026-01-31'),
            period('p2', '114 下', '2026-02-01', '2026-06-30'),
          ],
        }),
      );
      await setup();
      const items = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('ul[aria-label="繳費週期"] li'),
      ).map(byChild);
      expect(items).toEqual(['114 下 2026/02/01 – 2026/06/30', '114 上 2025/09/01 – 2026/01/31']);
      const link = (fixture.nativeElement as HTMLElement).querySelector(
        'a[href="/admin/fee-templates"]',
      );
      expect(link?.textContent).toContain('到費用方案頁');
    });

    it('週期讀失敗 → 講讀不到，不畫「還沒有週期」', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      billingPeriodsMock.list.mockReturnValue(throwError(() => new Error('boom')));
      await setup();
      expect(bodyText()).toContain('沒有讀到繳費週期');
      expect(bodyText()).not.toContain('還沒有週期');
    });

    it('預設繳費期限：顯示讀到的值，儲存送 invoiceDueDays', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      orgSettingsServiceMock.updateSettings.mockReturnValue(of({ ...FINANCE, invoiceDueDays: 10 }));
      await setup();
      expect(bodyText()).toContain('預設繳費期限');
      const page = component as unknown as {
        invoiceDueDaysValue: number;
        saveFinanceBasics: () => void;
      };
      expect(page.invoiceDueDaysValue).toBe(7);
      page.invoiceDueDaysValue = 10;
      page.saveFinanceBasics();
      // kv 一顆儲存：三欄一起送（都有讀到才送 —— 只有一欄的情況見上面兩支）
      expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({
        invoiceDueDays: 10,
        billingReminderDays: 14,
        leaveWaiverDays: 3,
      });
    });

    // 二讀突變 F5：後端可能夾值或改寫，畫面要跟著存回來的值，不是留著使用者打的數
    it('儲存成功後欄位改成回應裡的值', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      orgSettingsServiceMock.updateSettings.mockReturnValue(of({ ...FINANCE, invoiceDueDays: 21 }));
      await setup();
      const page = component as unknown as {
        invoiceDueDaysValue: number;
        saveFinanceBasics: () => void;
      };
      page.invoiceDueDaysValue = 10;
      page.saveFinanceBasics();
      expect(page.invoiceDueDaysValue).toBe(21);
    });

    // 二讀突變 F10：收起來時摘要不能只剩期限 —— 沒設提醒要明講
    it('沒有任何提醒時間點 → 摘要寫「不推播提醒」', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(
        of({ ...FINANCE, invoiceReminderOffsets: [] }),
      );
      await setup();
      expect(summaries()[3]).toBe('繳費 期限 7 天 · 不推播提醒');
    });

    // 二讀突變 F14：重試成功之後失敗訊息不能還掛著
    it('週期讀失敗後重試成功 → 失敗訊息消失、列出週期', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      billingPeriodsMock.list.mockReturnValueOnce(throwError(() => new Error('boom')));
      await setup();
      expect(bodyText()).toContain('沒有讀到繳費週期');

      billingPeriodsMock.list.mockReturnValue(
        of({ data: [period('p1', '114 上', '2025-09-01', '2026-01-31')] }),
      );
      (component as unknown as { loadPeriods: () => void }).loadPeriods();
      fixture.detectChanges();
      expect(bodyText()).not.toContain('沒有讀到繳費週期');
      expect(bodyText()).toContain('114 上');
    });
  });

  describe('報名流程段（#1821）', () => {
    const summary = () =>
      // 前兩段是出勤（#1882），報名流程是第三段
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('summary')]
        .find((el) => el.textContent?.includes('報名流程'))!
        .textContent!.replace(/\s+/g, ' ')
        .trim();

    it('天數 0 的寫「不提醒」', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(
        of({ ...DAILY_CHECKIN, applicationReviewDays: 0, trialFollowupDays: 5 }),
      );
      await setup();
      expect(summary()).toContain('審核不提醒 · 試聽跟進 5 天');
    });

    it('讀入設定值，儲存一起送兩欄，欄位跟著回應', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(
        of({ ...DAILY_CHECKIN, applicationReviewDays: 4, trialFollowupDays: 2 }),
      );
      orgSettingsServiceMock.updateSettings.mockReturnValue(
        of({ ...DAILY_CHECKIN, applicationReviewDays: 7, trialFollowupDays: 0 }),
      );
      await setup();
      const page = component as unknown as {
        applicationReviewDaysValue: number;
        trialFollowupDaysValue: number;
        saveApplicationFlow: () => void;
      };
      expect([page.applicationReviewDaysValue, page.trialFollowupDaysValue]).toEqual([4, 2]);
      page.applicationReviewDaysValue = 6;
      page.trialFollowupDaysValue = 0;
      page.saveApplicationFlow();
      expect(orgSettingsServiceMock.updateSettings).toHaveBeenCalledWith({
        applicationReviewDays: 6,
        trialFollowupDays: 0,
      });
      expect([page.applicationReviewDaysValue, page.trialFollowupDaysValue]).toEqual([7, 0]);
    });

    // 二讀：失敗不復原的話，按鈕會一直轉、按不了第二次
    it('儲存失敗：跳錯誤、按鈕不再 loading', async () => {
      orgSettingsServiceMock.updateSettings.mockReturnValue(throwError(() => new Error('boom')));
      await setup();
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');
      component['saveApplicationFlow']();
      expect(component['savingApplicationFlow']()).toBe(false);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });
  });
});
