import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { OrgSettingsService, type OrgSettings } from '@core/org-settings.service';

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

  /** ngOnInit 在第一次 `detectChanges()` 跑，所以取數的結果要在建立元件之前就決定 */
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [{ provide: OrgSettingsService, useValue: orgSettingsServiceMock }],
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
});
