import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { OrgSettingsService, type OrgSettings } from '@core/org-settings.service';
import { BillingPeriodsService } from '@core/billing-periods.service';
import { provideRouter } from '@angular/router';

import { SettingsPage } from './settings.page';

const DAILY_CHECKIN: OrgSettings = {
  id: 'org-1',
  name: 'Clessia Demo',
  attendanceMode: 'daily_checkin',
  attendanceResponsible: 'admin',
  attendanceRetroactiveDays: 0,
};

describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;

  const orgSettingsServiceMock = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  const billingPeriodsMock = { list: vi.fn() };

  /** ngOnInit 在第一次 `detectChanges()` 跑，所以取數的結果要在建立元件之前就決定 */
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        MessageService,
        provideRouter([]),
        { provide: OrgSettingsService, useValue: orgSettingsServiceMock },
        { provide: BillingPeriodsService, useValue: billingPeriodsMock },
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

    it('沒有財務權限（回應沒有財務 key）→ 兩段都不畫，也不讀週期', async () => {
      await setup();
      expect(summaries()).toEqual([]);
      expect(billingPeriodsMock.list).not.toHaveBeenCalled();
    });

    it('有財務權限 → 「繳費」摘要寫生效值、「週期」摘要寫幾個', async () => {
      orgSettingsServiceMock.getSettings.mockReturnValue(of(FINANCE));
      billingPeriodsMock.list.mockReturnValue(
        of({ data: [period('p1', '114 上', '2025-09-01', '2026-01-31')] }),
      );
      await setup();
      expect(summaries()).toEqual([
        '繳費 期限 7 天 · 到期前 3 天、到期當天提醒',
        '學期與繳費週期 1 個週期',
      ]);
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
  });
});
