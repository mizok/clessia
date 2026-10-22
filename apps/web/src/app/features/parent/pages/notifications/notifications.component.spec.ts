import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService } from '@core/announcements.service';
import { NotificationsService } from '@core/notifications.service';
import { PushService, type PushState } from '@core/push.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { NotificationsComponent } from './notifications.component';

describe('ParentNotificationsComponent', () => {
  let fixture: ComponentFixture<NotificationsComponent>;

  const announcementsServiceMock = {
    inbox: vi.fn(() =>
      of({
        data: [
          {
            id: 'a1',
            title: '國一數學 A 班 調課通知',
            body: '1/30 的課堂已調整至 2/2',
            publishedAt: '2026-09-01T08:00:00Z',
            campusName: '台北分校',
            createdByName: '王主任',
            isRead: false,
          },
        ],
        meta: { total: 1, unread: 1 },
      }),
    ),
    markRead: vi.fn(() => of({})),
    markAllRead: vi.fn(() => of({})),
  };

  // push-settings 掛在彈窗裡、彈窗開著才掛；這一層只驗入口與提示列，push-settings 自己有 spec
  const pushMock = {
    state: signal<PushState>('default'),
    refresh: vi.fn(() => Promise.resolve()),
    enable: vi.fn(() => Promise.resolve()),
    preferences: vi.fn(() => of({ preferences: [] })),
    devices: vi.fn(() => of({ data: [] })),
  };

  // jsdom 沒有 <dialog> 的 modal 行為：只補開關狀態與 close 事件（照 admin notifications spec）
  const dialogProto = HTMLDialogElement.prototype;
  const originalDialog = { showModal: dialogProto.showModal, close: dialogProto.close };
  afterEach(() => Object.assign(dialogProto, originalDialog));

  async function render(state: PushState): Promise<void> {
    pushMock.state.set(state);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const hint = () => el().querySelector('[data-testid="push-hint-enable"]');
  const settingsBtn = () => el().querySelector<HTMLButtonElement>('[data-testid="push-settings-open"]')!;

  beforeEach(async () => {
    announcementsServiceMock.inbox.mockClear();
    pushMock.enable.mockClear();
    pushMock.state.set('default');
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        { provide: AnnouncementsService, useValue: announcementsServiceMock },
        { provide: PushService, useValue: pushMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // 通知那一支（#1683 第二段）：空的，這一層只驗接線
        {
          provide: NotificationsService,
          useValue: {
            inbox: () => of({ data: [], meta: { total: 0, unread: 0 } }),
            markRead: () => of(undefined),
            markAllRead: () => of({ marked: 0 }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsComponent);
    fixture.componentRef.setInput('page', RoutesCatalog.PARENT_NOTIFICATIONS);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  // 這一頁原本是 empty-state 空殼（「這個功能還在準備中」）
  it('渲染的是真的收件匣，不是空殼', () => {
    expect(fixture.nativeElement.querySelector('.announcement-inbox')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('還在準備中');
  });

  it('公告內容出得來', () => {
    expect(fixture.nativeElement.textContent).toContain('國一數學 A 班 調課通知');
  });

  // 家長跟老師打同一支端點，伺服器依 audience 決定回哪些 —— 前端不帶角色參數
  it('用的是共用收件匣的同一支查詢，沒有另外傳角色', () => {
    expect(announcementsServiceMock.inbox).toHaveBeenCalledWith();
  });

  describe('繳費提醒推播（#1888：收進工具列的彈窗，A6 偏離 R5）', () => {
    it('工具列鈕寫出這台裝置的狀態：未開啟／已開啟', async () => {
      await render('default');
      expect(settingsBtn().textContent).toContain('通知設定：未開啟');
      await render('enabled');
      expect(settingsBtn().textContent).toContain('通知設定：已開啟');
    });

    it('偵測中不寫狀態字（不閃一下「未開啟」）', async () => {
      await render('loading');
      expect(settingsBtn().textContent).not.toContain('：');
    });

    it('點開才掛 push-settings，關掉就拿掉（每次打開重讀）', async () => {
      expect(el().querySelector('app-push-settings')).toBeNull();
      settingsBtn().click();
      fixture.detectChanges();
      const dialog = el().querySelector<HTMLDialogElement>('[data-testid="push-settings-dialog"]')!;
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('app-push-settings')).not.toBeNull();

      dialog.close();
      fixture.detectChanges();
      expect(el().querySelector('app-push-settings')).toBeNull();
    });

    it('點彈窗裡的內容不會關，點背景（dialog 本身）才關', async () => {
      settingsBtn().click();
      fixture.detectChanges();
      const dialog = el().querySelector<HTMLDialogElement>('[data-testid="push-settings-dialog"]')!;
      dialog.querySelector<HTMLElement>('app-push-settings')!.click();
      expect(dialog.open).toBe(true);

      dialog.click();
      expect(dialog.open).toBe(false);
    });

    it('還沒開過（default）：色面句下面有提示＋開啟鈕，按了直接開啟', async () => {
      await render('default');
      expect(hint()).not.toBeNull();
      (hint() as HTMLButtonElement).click();
      expect(pushMock.enable).toHaveBeenCalledTimes(1);
    });

    it.each(['enabled', 'off', 'denied', 'unsupported', 'loading'] as const)(
      '%s：沒有提示列',
      async (state) => {
        await render(state);
        expect(hint()).toBeNull();
      },
    );

    it('開啟鈕按下時停用，結束後（成功或失敗）都解開，不會一直卡著', async () => {
      let done!: () => void;
      pushMock.enable.mockReturnValueOnce(new Promise<void>((r) => (done = r)));
      await render('default');
      (hint() as HTMLButtonElement).click();
      fixture.detectChanges();
      expect((hint() as HTMLButtonElement).disabled).toBe(true);

      done();
      await fixture.whenStable();
      fixture.detectChanges();
      expect((hint() as HTMLButtonElement).disabled).toBe(false);

      pushMock.enable.mockReturnValueOnce(Promise.reject(new Error('boom')));
      (hint() as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect((hint() as HTMLButtonElement).disabled).toBe(false);
    });

    it('開啟失敗：提示列寫一行「沒有設定成功」', async () => {
      pushMock.enable.mockReturnValueOnce(Promise.reject(new Error('boom')));
      await render('default');
      (hint() as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().textContent).toContain('沒有設定成功，請再試一次。');
    });
  });

  // A6：色面句是這一頁的那句話（未讀數），頁名只在資料還沒到時頂著
  it('色面句寫未讀數，不是頁名', () => {
    const h1 = (fixture.nativeElement as HTMLElement).querySelector('app-page-open h1')!;
    expect(h1.textContent).toContain('1 則未讀，');
    expect(h1.textContent).not.toContain(RoutesCatalog.PARENT_NOTIFICATIONS.label);
  });
});
