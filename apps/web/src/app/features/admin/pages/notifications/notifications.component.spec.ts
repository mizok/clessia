import { MessageService } from 'primeng/api';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
import { AuthService } from '@core/auth.service';
import { CampusesService } from '@core/campuses.service';
import { InboxBadgeService } from '@core/inbox-badge.service';
import { NotificationsService, type AppNotification } from '@core/notifications.service';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

import { NotificationsComponent } from './notifications.component';

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a1',
    title: '本週三停課',
    body: '因颱風假停課一天。',
    audience: 'all_teachers',
    campusId: null,
    campusName: null,
    publishedAt: '2026-08-18T02:00:00Z',
    createdByName: '王主任',
    isRead: false,
    ...overrides,
  };
}

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    kind: 'application_received',
    title: '新的試聽申請',
    body: '王小明的家長送出了試聽申請。',
    createdAt: '2026-10-16T01:00:00Z',
    isRead: false,
    link: '/admin/applications',
    ...overrides,
  };
}

describe('NotificationsComponent（管理端發布）', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let component: NotificationsComponent;

  const listMock = vi.fn();
  const createMock = vi.fn();
  const campusesMock = vi.fn();
  /** #1686：發布要 `send_announcements`。多數測試的主題不是權限，預設有 */
  let canSend = true;
  const authStub = { hasPermission: (p: string) => p === 'send_announcements' && canSend };

  /**
   * #1692：預設分頁是「收到的」。發布那半的既有測試都在 `#publish` 上跑（fragment 預設 publish），
   * 收件匣的測試自己把它設成 null。
   */
  let fragment: string | null = 'publish';
  let received: AppNotification[] = [];
  let receivedUnread: number | null = null;
  const notifInboxMock = vi.fn();
  const markReadMock = vi.fn();
  const markAllReadMock = vi.fn();
  const setNotificationsUnread = vi.fn();
  const extraProviders = () => [
    provideRouter([]),
    { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
    {
      provide: NotificationsService,
      useValue: { inbox: notifInboxMock, markRead: markReadMock, markAllRead: markAllReadMock },
    },
    { provide: InboxBadgeService, useValue: { setNotificationsUnread } },
  ];

  // jsdom 沒有 <dialog> 的 modal 行為：只補開關狀態與 close 事件（照 sessions.page.spec）
  const dialogProto = HTMLDialogElement.prototype;
  const originalDialog = { showModal: dialogProto.showModal, close: dialogProto.close };

  beforeEach(() => {
    canSend = true;
    fragment = 'publish';
    received = [];
    receivedUnread = null;
    notifInboxMock.mockReset();
    notifInboxMock.mockImplementation(() =>
      of({
        data: received,
        meta: {
          total: received.length,
          unread: receivedUnread ?? received.filter((n) => !n.isRead).length,
        },
      }),
    );
    markReadMock.mockReset();
    markReadMock.mockReturnValue(of(undefined));
    markAllReadMock.mockReset();
    markAllReadMock.mockImplementation(() =>
      of({ marked: receivedUnread ?? received.filter((n) => !n.isRead).length }),
    );
    setNotificationsUnread.mockReset();
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => Object.assign(dialogProto, originalDialog));

  async function setup(data: Announcement[] = []) {
    listMock.mockReset();
    createMock.mockReset();
    campusesMock.mockReset();
    listMock.mockReturnValue(of({ data, meta: { total: data.length, unread: 0 } }));
    createMock.mockReturnValue(of({ data: announcement() }));
    campusesMock.mockReturnValue(of({ data: [{ id: 'c1', name: '本校' }] }));

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        MessageService,
        {
          provide: AnnouncementsService,
          useValue: { list: listMock, create: createMock },
        },
        { provide: CampusesService, useValue: { list: campusesMock } },
        { provide: AuthService, useValue: authStub },
        ...extraProviders(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
    fixture.detectChanges();
  }

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('已發布清單載入中顯示骨架列表，不是整塊被文字取代', async () => {
    listMock.mockReset();
    createMock.mockReset();
    campusesMock.mockReset();
    listMock.mockReturnValue(NEVER);
    createMock.mockReturnValue(of({ data: announcement() }));
    campusesMock.mockReturnValue(of({ data: [{ id: 'c1', name: '本校' }] }));

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        MessageService,
        { provide: AnnouncementsService, useValue: { list: listMock, create: createMock } },
        { provide: CampusesService, useValue: { list: campusesMock } },
        { provide: AuthService, useValue: authStub },
        ...extraProviders(),
      ],
    }).compileComponents();

    const f = TestBed.createComponent(NotificationsComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-list .skeleton').length).toBeGreaterThan(0);
  });

  /**
   * #723（照 #664／#718 的方向）：**按鈕不再擋，按下去才驗、逐欄標錯。**
   *
   * 原本是 `[disabled]="!canSubmit()"` —— 沒填時按下去**什麼都不會發生**，
   * 沒有欄位標記也沒有解釋。現在按得下去，而**送不出去的理由看得見**。
   */
  it('標題或內容空白時按發布不會送出，而且兩個欄位同時標錯', async () => {
    await setup();
    createMock.mockClear();

    component['submit']();

    expect(createMock).not.toHaveBeenCalled();
    // **一次收集全部**，不是遇到第一個就 return
    expect(component['errors']()).toEqual({ title: '標題還沒填', body: '內容還沒填' });
  });

  it('只有空白字元也算空白', async () => {
    await setup();
    createMock.mockClear();
    component['title'].set('   ');
    component['body'].set('   ');

    component['submit']();

    expect(createMock).not.toHaveBeenCalled();
    expect(Object.keys(component['errors']())).toEqual(['title', 'body']);
  });

  it('發布鍵只在送出中才 disabled —— 沒填也按得下去', async () => {
    await setup();

    const btn = fixture.nativeElement.querySelector('[data-testid="publish"]');
    expect(btn.disabled).toBe(false);
  });

  it('錯誤訊息顯示在欄位旁邊，不是只有 toast', async () => {
    await setup();

    component['submit']();
    fixture.detectChanges();

    const texts = [...fixture.nativeElement.querySelectorAll('.admin-notifications__error-text')]
      .map((e) => (e as HTMLElement).textContent?.trim())
      .filter(Boolean);
    expect(texts).toEqual(['標題還沒填', '內容還沒填']);
    expect(
      fixture.nativeElement.querySelector('.admin-notifications__input.p-invalid'),
    ).not.toBeNull();
  });

  /** 錯誤是「上次送出時的狀態」，不是永久標籤 */
  it('改動欄位就清掉那一欄的錯誤，另一欄留著', async () => {
    await setup();
    component['submit']();
    expect(Object.keys(component['errors']())).toEqual(['title', 'body']);

    component['onTitleChange']('停課通知');

    expect(component['errors']()).toEqual({ body: '內容還沒填' });
  });

  it('送出時去掉前後空白並帶上分校', async () => {
    await setup();
    component['title'].set('  停課通知  ');
    component['body'].set('  內容  ');
    component['campusId'].set('c1');

    component['submit']();

    expect(createMock).toHaveBeenCalledWith({
      title: '停課通知',
      body: '內容',
      audience: 'all_teachers',
      campusId: 'c1',
    });
  });

  /**
   * #636:這個下拉原本鎖成常數,理由是「家長端全是空殼,發給家長沒人收得到」。
   * **那個理由在 2026-09-04 就不成立了**(PR #291 把家長端通知中心接上了),
   * 而註解沒有被回頭檢查 —— 五天後可用性測試才撞出來。
   *
   * 這三支守的是解鎖之後的三件事:**預設沒變**、**選得到家長**、**選了會送出去**。
   */
  it('預設仍然是全體老師 —— 解鎖不等於改預設', async () => {
    await setup();

    expect(component['audience']()).toBe('all_teachers');
  });

  it('發送對象選得到家長', async () => {
    await setup();

    expect(component['audienceOptions'].map((o) => o.value)).toEqual([
      'all_teachers',
      'all_parents',
    ]);
  });

  it('選了家長之後送出去的是 all_parents', async () => {
    await setup();
    component['title'].set('停課通知');
    component['body'].set('內容');
    component['audience'].set('all_parents');

    component['submit']();

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ audience: 'all_parents' }));
  });

  it('發布成功後清空表單並重新載入清單', async () => {
    await setup();
    component['title'].set('停課通知');
    component['body'].set('內容');
    listMock.mockClear();

    component['submit']();

    expect(component['title']()).toBe('');
    expect(component['body']()).toBe('');
    expect(listMock).toHaveBeenCalled();
  });

  it('發布失敗時保留輸入內容並顯示錯誤', async () => {
    await setup();
    createMock.mockReturnValue(throwError(() => new Error('boom')));
    component['title'].set('停課通知');
    component['body'].set('內容');

    component['submit']();

    expect(component['submitError']()).toContain('發布失敗');
    expect(component['title']()).toBe('停課通知');
  });

  it('列出已發布的公告', async () => {
    await setup([announcement({ campusName: '本校' })]);

    expect(fixture.nativeElement.textContent).toContain('本週三停課');
    expect(fixture.nativeElement.textContent).toContain('全體老師');
  });

  /**
   * 發布時間用 `yyyy/MM/dd HH:mm`（斜線），照 A6 稿（`notifications.html` 的 `at.replaceAll('-', '/')`，
   * #1314 計畫席 2026-10-14 裁：A6 全採，**晚於** #425 M4 的連字號決定）。**年份留著**是情境選擇 ——
   * 這是「發布過的全部公告」，會跨年；老師端收件匣看的是最近收到的，所以那邊用短版 `MM/dd HH:mm`。
   * 稿裡顯示完整日期的四頁（通知中心、費用方案、學生檔案、設定）全是斜線。
   */
  it('發布時間用斜線而不是連字號', async () => {
    await setup([announcement({ campusName: '本校' })]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('2026/08/18');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('沒有分校的公告顯示為全部分校', async () => {
    await setup([announcement({ campusName: null })]);

    expect(fixture.nativeElement.textContent).toContain('全部分校');
  });

  describe('A6 版（#1314 NT3）', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        `[data-testid="${id}"]`,
      ) as HTMLElement | null;
    const qa = (id: string) => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        `[data-testid="${id}"]`,
      ),
    ];

    it('已發布依月份分章，新到舊；章頭有月份與則數', async () => {
      await setup([
        announcement({ id: 'a', publishedAt: '2026-08-18T02:00:00Z' }),
        announcement({ id: 'b', publishedAt: '2026-10-02T02:00:00Z' }),
        announcement({ id: 'c', publishedAt: '2026-10-01T02:00:00Z' }),
      ]);

      const chapters = component['chapters']();
      expect(chapters.map((g) => g.key)).toEqual(['2026-10', '2026-08']);
      expect(chapters[0].items.map((i) => i.id)).toEqual(['b', 'c']);
      expect(qa('chapter')).toHaveLength(2);
      expect(qa('chapter')[0].textContent).toContain('2 則');
    });

    it('月份用台北時區切：UTC 月底晚上＝台北下個月初', async () => {
      await setup([announcement({ publishedAt: '2026-09-30T17:30:00Z' })]);

      expect(component['chapters']()[0].key).toBe('2026-10');
      // 顯示的時間也是台北：2026/10/01 01:30
      expect(q('meta')!.textContent).toContain('2026/10/01 01:30');
    });

    it('台北日界線 ±1 分鐘：15:59Z＝當天 23:59、16:00Z＝隔天 00:00；月日補零', async () => {
      await setup([announcement({ publishedAt: '2026-09-30T15:59:00Z' })]);
      expect(q('meta')!.textContent).toContain('2026/09/30 23:59');
      TestBed.resetTestingModule();
      await setup([announcement({ publishedAt: '2026-09-30T16:00:00Z' })]);
      expect(q('meta')!.textContent).toContain('2026/10/01 00:00');
      TestBed.resetTestingModule();
      await setup([announcement({ publishedAt: '2026-02-03T02:05:00Z' })]);
      expect(q('meta')!.textContent).toContain('2026/02/03 10:05');
    });

    it('跨年的章名帶年份', async () => {
      await setup([announcement({ publishedAt: '2019-12-05T02:00:00Z' })]);

      expect(component['chapters']()[0].name).toBe('2019 年 12 月');
    });

    it('色面句兩段：已發布幾則／上一則是哪天；沒有公告時照實說（只有一行）', async () => {
      await setup([
        announcement({ id: 'a', publishedAt: '2026-08-18T02:00:00Z' }),
        announcement({ id: 'b', publishedAt: '2026-10-02T02:00:00Z' }),
      ]);
      expect(component['headline']()).toEqual({
        first: '已發布 2 則公告，',
        second: '上一則是 10/2。',
      });
      // 兩行：兩段之間有一個 <br>（桌機、手機都一樣，沒有斷點）
      expect(fixture.nativeElement.querySelectorAll('app-page-open br')).toHaveLength(1);

      TestBed.resetTestingModule();
      await setup([announcement({ id: 'c', publishedAt: '2026-09-30T17:30:00Z' })]);
      // 1 則；上一則的日期用台北：UTC 9/30 17:30 ＝ 台北 10/1
      expect(component['headline']()).toEqual({
        first: '已發布 1 則公告，',
        second: '上一則是 10/1。',
      });

      TestBed.resetTestingModule();
      await setup([]);
      expect(component['headline']()).toEqual({ first: '還沒有發布過公告。', second: null });
      expect(fixture.nativeElement.querySelectorAll('app-page-open br')).toHaveLength(0);
    });

    // A6 `.chap`：每一章（含最後一章）上下 32px（手機 24px）、有下框（#1689 順手改）
    it('分章的外框照 A6：上下內距、每章都有下框、兩欄 208px', async () => {
      await setup([announcement()]);
      const chapter = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="chapter"]',
      )!;
      expect([...chapter.classList]).toEqual(
        expect.arrayContaining([
          'py-6',
          'wide:py-8',
          'border-b',
          'wide:grid-cols-[208px_minmax(0,1fr)]',
        ]),
      );
      expect(chapter.classList).not.toContain('last:border-b-0');
    });

    it('載入中色面不宣稱「還沒有發布過公告」', async () => {
      listMock.mockReset();
      listMock.mockReturnValue(NEVER);
      createMock.mockReset();
      campusesMock.mockReset();
      campusesMock.mockReturnValue(of({ data: [] }));
      await TestBed.configureTestingModule({
        imports: [NotificationsComponent],
        providers: [
          MessageService,
          { provide: AnnouncementsService, useValue: { list: listMock, create: createMock } },
          { provide: CampusesService, useValue: { list: campusesMock } },
          { provide: AuthService, useValue: authStub },
          ...extraProviders(),
        ],
      }).compileComponents();
      const f = TestBed.createComponent(NotificationsComponent);
      f.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
      f.detectChanges();

      expect(f.componentInstance['headline']()).toBeNull();
      expect(f.nativeElement.textContent).not.toContain('還沒有發布過公告');
    });

    it('列：標題、時間·分校、對象 pill；沒有舊的副標', async () => {
      await setup([announcement({ campusName: '本校', audience: 'all_parents' })]);

      expect(q('announcement')!.textContent).toContain('本週三停課');
      expect(q('audience')!.textContent).toContain('全體家長');
      expect(q('meta')!.textContent).toContain('本校');
      expect(fixture.nativeElement.textContent).not.toContain('發布站內公告給老師或家長');
    });

    it('按發布：空標題與內容 → 焦點到標題；只缺內容 → 焦點到內容', async () => {
      await setup();

      component['submit']();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('input[type=text]'));

      component['title'].set('停課通知');
      component['submit']();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('textarea'));
    });

    it('發布成功跳 toast：寫出對象與分校', async () => {
      await setup();
      const spy = vi.spyOn(component['messageService'], 'add');
      component['title'].set('停課通知');
      component['body'].set('內容');
      component['audience'].set('all_parents');
      component['campusId'].set('c1');

      component['submit']();

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success', detail: '已發布給全體家長（本校）' }),
      );
    });

    it('發布失敗不跳成功 toast', async () => {
      await setup();
      const spy = vi.spyOn(component['messageService'], 'add');
      createMock.mockReturnValue(throwError(() => new Error('boom')));
      component['title'].set('停課通知');
      component['body'].set('內容');

      component['submit']();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // #1641 5b（使用者 10-16 裁定第 2、3 點）：發布後重抓時舊的公告留著變淡，不回到骨架
  it('發布後重抓：舊的公告留著並變淡，不回到骨架', async () => {
    await setup([announcement()]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="announcement"]').length).toBe(1);

    listMock.mockReturnValue(NEVER);
    component['title'].set('停課通知');
    component['body'].set('內容');
    component['submit']();
    fixture.detectChanges();

    expect(el.querySelector('.reload-veil--stale')).not.toBeNull();
    expect(el.querySelector('.skeleton-list')).toBeNull();
    expect(el.querySelectorAll('[data-testid="announcement"]').length).toBe(1);
  });

  describe('「發送通知」權限（#1686）', () => {
    it('沒有 send_announcements：看不到發布表單，列表照常', async () => {
      canSend = false;
      await setup([announcement()]);
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.admin-notifications__composer')).toBeNull();
      expect(el.querySelectorAll('[data-testid="announcement"]')).toHaveLength(1);
    });

    it('有 send_announcements：發布表單在', async () => {
      await setup();

      expect(fixture.nativeElement.querySelector('.admin-notifications__composer')).not.toBeNull();
    });
  });

  describe('發送通知改成彈窗（#1689）', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const dialog = () => el().querySelector<HTMLDialogElement>('[data-testid="composer"]');
    const openViaPageAction = () => {
      el().querySelector<HTMLButtonElement>('.page-actions__header-primary button')!.click();
      fixture.detectChanges();
    };

    it('頁面上沒有發布表單，只有列表；表單在彈窗裡、一開始是關的', async () => {
      await setup([announcement()]);

      expect(dialog()).not.toBeNull();
      expect(dialog()!.open).toBe(false);
      expect(dialog()!.querySelector('.admin-notifications__composer')).not.toBeNull();
      expect(el().querySelectorAll('[data-testid="announcement"]')).toHaveLength(1);
    });

    it('按頁首的「發送通知」打開彈窗', async () => {
      await setup([announcement()]);

      openViaPageAction();

      expect(dialog()!.open).toBe(true);
    });

    it('沒有 send_announcements：沒有入口、沒有彈窗、空狀態也沒有按鈕', async () => {
      canSend = false;
      await setup([]);

      expect(el().querySelector('app-page-actions')).toBeNull();
      expect(dialog()).toBeNull();
      expect(el().querySelector('[data-testid="empty-send"]')).toBeNull();
      expect(el().textContent).toContain('還沒有發布過公告。');
    });

    it('空狀態有權限也不另放「發送通知」：主按鈕只在頁首一顆', async () => {
      await setup([]);

      expect(el().textContent).toContain('還沒有發布過公告。');
      expect(el().querySelector('[data-testid="empty-send"]')).toBeNull();
      expect(el().querySelectorAll('app-page-actions')).toHaveLength(1);
    });

    it('沒填就按發布：彈窗不關、焦點到標題', async () => {
      await setup([announcement()]);
      openViaPageAction();

      el().querySelector<HTMLButtonElement>('[data-testid="publish"]')!.click();
      fixture.detectChanges();

      expect(dialog()!.open).toBe(true);
      expect(document.activeElement).toBe(el().querySelector('.admin-notifications__input'));
    });

    it('發布成功：關彈窗、toast、清空、重抓列表', async () => {
      await setup([announcement()]);
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      openViaPageAction();
      component['title'].set('停課通知');
      component['body'].set('內容');
      listMock.mockClear();

      el().querySelector<HTMLButtonElement>('[data-testid="publish"]')!.click();

      expect(dialog()!.open).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ detail: '已發布給全體老師（全部分校）' }),
      );
      expect(component['title']()).toBe('');
      expect(listMock).toHaveBeenCalled();
    });

    it('發布失敗：彈窗不關、錯誤在彈窗裡、內容留著', async () => {
      await setup([announcement()]);
      createMock.mockReturnValue(throwError(() => new Error('boom')));
      openViaPageAction();
      component['title'].set('停課通知');
      component['body'].set('內容');

      el().querySelector<HTMLButtonElement>('[data-testid="publish"]')!.click();
      fixture.detectChanges();

      expect(dialog()!.open).toBe(true);
      expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('發布失敗');
      expect(component['title']()).toBe('停課通知');
    });

    it('送出中按鈕寫「發布中…」並停用', async () => {
      await setup([announcement()]);
      createMock.mockReturnValue(NEVER);
      openViaPageAction();
      component['title'].set('停課通知');
      component['body'].set('內容');

      const btn = el().querySelector<HTMLButtonElement>('[data-testid="publish"]')!;
      btn.click();
      fixture.detectChanges();

      expect(btn.disabled).toBe(true);
      expect(btn.textContent?.trim()).toBe('發布中…');
    });

    it('取消或點背景關掉，草稿留著；點彈窗裡面不會關', async () => {
      await setup([announcement()]);
      openViaPageAction();
      component['onTitleChange']('寫到一半');

      dialog()!.querySelector<HTMLElement>('.admin-notifications__composer')!.click();
      expect(dialog()!.open).toBe(true);

      dialog()!.click(); // target＝dialog 本身＝點到 backdrop
      expect(dialog()!.open).toBe(false);

      openViaPageAction();
      expect(component['title']()).toBe('寫到一半');
      const cancel = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === '取消',
      )!;
      cancel.click();
      expect(dialog()!.open).toBe(false);
      expect(component['title']()).toBe('寫到一半');
    });
  });

  describe('收到的（#1692）', () => {
    const q = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        `[data-testid="${id}"]`,
      ) as HTMLElement | null;
    const qa = (id: string) => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        `[data-testid="${id}"]`,
      ),
    ];
    /** 展開一列：jsdom 的 <details> 設 open 不會發 toggle，自己發 */
    function expand(row: HTMLElement): void {
      (row as HTMLDetailsElement).open = true;
      row.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();
    }

    beforeEach(() => {
      fragment = null;
      // 台北 2026-10-16（四）18:00
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('預設打開「收到的」，分頁列寫未讀數；`#publish` 直接開發布', async () => {
      received = [notification(), notification({ id: 'n2', isRead: true })];
      await setup();
      expect(q('tab-inbox')!.getAttribute('aria-current')).toBe('page');
      expect(q('tab-unread')!.textContent!.trim()).toBe('未讀 1');
      expect(qa('notification')).toHaveLength(2);
      expect(qa('announcement')).toHaveLength(0);

      TestBed.resetTestingModule();
      fragment = 'publish';
      await setup([announcement()]);
      expect(q('tab-publish')!.getAttribute('aria-current')).toBe('page');
      expect(qa('notification')).toHaveLength(0);
      expect(qa('announcement')).toHaveLength(1);
    });

    it('切分頁只換網址的 hash，不進歷史', async () => {
      await setup();
      const location = TestBed.inject(Location);
      const spy = vi.spyOn(location, 'replaceState');
      q('tab-publish')!.click();
      fixture.detectChanges();
      expect(spy).toHaveBeenLastCalledWith(expect.stringMatching(/#publish$/));
      expect(q('mark-all')).toBeNull();
      q('tab-inbox')!.click();
      fixture.detectChanges();
      expect(spy).toHaveBeenLastCalledWith(expect.not.stringContaining('#'));
      expect(q('mark-all')).not.toBeNull();
    });

    it('依今天／昨天／這週／更早分章，台北日界線切；章頭寫則數與未讀', async () => {
      received = [
        notification({ id: 'today', createdAt: '2026-10-15T16:00:00Z' }), // 台北 10/16 00:00
        notification({ id: 'yday', createdAt: '2026-10-15T15:59:00Z', isRead: true }), // 10/15 23:59
        notification({ id: 'week', createdAt: '2026-10-10T00:00:00Z' }), // 10/10＝今天往前 6 天
        notification({ id: 'old', createdAt: '2026-10-09T15:59:00Z' }), // 10/9 23:59
      ];
      await setup();
      const chapters = component['inboxChapters']();
      expect(chapters.map((c) => [c.name, c.items.map((i) => i.id)])).toEqual([
        ['今天', ['today']],
        ['昨天', ['yday']],
        ['這週', ['week']],
        ['更早', ['old']],
      ]);
      expect(qa('inbox-chapter')[0].textContent).toContain('未讀 1');
      expect(qa('inbox-chapter')[1].textContent).not.toContain('未讀');
      // A6「1 則 · 未讀 1」是同一段字，不是小字補充（#1715）
      expect(
        qa('inbox-chapter')[0].querySelector('.chapter-head__tally')!.firstChild!.textContent,
      ).toBe('1 則 · 未讀 1');
    });

    it('色面句：N 則未讀＋今天幾則；全部讀過；一則都沒有', async () => {
      received = [
        notification({ id: 'a' }),
        notification({ id: 'b', createdAt: '2026-10-14T01:00:00Z' }),
      ];
      await setup();
      expect(component['headline']()).toEqual({ first: '2 則未讀，', second: '今天 1 則新通知。' });

      TestBed.resetTestingModule();
      received = [notification({ isRead: true })];
      await setup();
      expect(component['headline']()).toEqual({ first: '通知都看過了。', second: null });

      TestBed.resetTestingModule();
      received = [];
      await setup();
      expect(component['headline']()).toEqual({ first: '還沒有收到通知。', second: null });
      expect(fixture.nativeElement.textContent).toContain('通知保留 90 天。');
    });

    it('未讀數用伺服器的 meta.unread，不數畫面上的（清單最多 100 則）', async () => {
      received = [notification()];
      receivedUnread = 130;
      await setup();
      expect(q('tab-unread')!.textContent!.trim()).toBe('未讀 130');
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(130);
    });

    it('展開＝已讀：橘點與粗體拿掉、角標寫回；已讀的再展開不打 API', async () => {
      received = [notification(), notification({ id: 'n2', isRead: true })];
      await setup();
      const [unreadRow, readRow] = qa('notification');
      expect(unreadRow.querySelector('[data-testid=title]')!.classList).toContain('font-bold');

      expand(unreadRow);
      expect(markReadMock).toHaveBeenCalledWith('n1');
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(0);
      expect(qa('notification')[0].getAttribute('data-read')).toBe('true');
      expect(qa('notification')[0].querySelector('[data-testid=title]')!.classList).not.toContain(
        'font-bold',
      );

      expand(readRow);
      expect(markReadMock).toHaveBeenCalledTimes(1);
    });

    it('標已讀失敗：翻回未讀、角標翻回、寫一行錯誤', async () => {
      received = [notification()];
      markReadMock.mockReturnValue(throwError(() => new Error('x')));
      await setup();
      expand(qa('notification')[0]);
      expect(qa('notification')[0].getAttribute('data-read')).toBe('false');
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(1);
      expect(fixture.nativeElement.textContent).toContain('沒標成已讀');
    });

    // #1710 實機抓到的：點有 link 的通知馬上導頁，元件 destroy 會把 POST 一起取消
    it('標已讀的請求不跟元件同生死：送出後馬上離開頁面也照樣送到', async () => {
      received = [notification()];
      const pending = new Subject<void>();
      markReadMock.mockReturnValue(pending.asObservable());
      await setup();
      expand(qa('notification')[0]);
      fixture.destroy();
      // 掛了 takeUntilDestroyed 的話，destroy 當下就退訂（HttpClient 會取消請求）
      expect(pending.observed).toBe(true);
      expect(markReadMock).toHaveBeenCalledTimes(1);
    });

    it('有 link 才有連結，字照 kind；點了走 router；沒列到的 kind 寫「系統通知」', async () => {
      received = [
        notification({ kind: 'overdue_digest', link: '/admin/billing' }),
        notification({ id: 'n2', kind: 'something_new', link: null }),
      ];
      await setup();
      const router = TestBed.inject(Router);
      const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const [withLink, without] = qa('notification');
      expect(withLink.querySelector('[data-testid=kind]')!.textContent).toContain('逾期帳單');
      const go = withLink.querySelector<HTMLAnchorElement>('[data-testid=go]')!;
      expect(go.textContent).toContain('看逾期帳單');
      expect(go.getAttribute('href')).toBe('/admin/billing');
      go.click();
      expect(nav).toHaveBeenCalledWith('/admin/billing');
      expect(without.querySelector('[data-testid=go]')).toBeNull();
      expect(without.querySelector('[data-testid=kind]')!.textContent).toContain('系統通知');
    });

    // #1695：家長請假的收件人就是管理員，少了這一條會退回「系統通知」
    // #1732：財務管理員收的連續請假提醒
    it('連續請假（leave_streak）：標籤「連續請假」、連結字「看明細」', async () => {
      received = [notification({ kind: 'leave_streak', link: '/admin/students/s1#billing' })];
      await setup();
      const row = qa('notification')[0];
      expect(row.querySelector('[data-testid=kind]')!.textContent).toContain('連續請假');
      expect(row.querySelector('[data-testid=go]')!.textContent).toContain('看明細');
    });

    it('家長請假（leave_received）：標籤「家長請假」、連結字「看請假」', async () => {
      received = [notification({ kind: 'leave_received', link: '/admin/leave' })];
      await setup();
      const row = qa('notification')[0];
      expect(row.querySelector('[data-testid=kind]')!.textContent).toContain('家長請假');
      expect(row.querySelector('[data-testid=go]')!.textContent).toContain('看請假');
    });

    it('學年升級前提醒（grade_promotion_reminder）：標籤「學年升級」、連結字「到設定預覽」', async () => {
      received = [
        notification({ kind: 'grade_promotion_reminder', link: '/admin/settings/general' }),
      ];
      await setup();
      const row = qa('notification')[0];
      expect(row.querySelector('[data-testid=kind]')!.textContent).toContain('學年升級');
      expect(row.querySelector('[data-testid=go]')!.textContent).toContain('到設定預覽');
    });

    it.each([
      ['application_overdue', '申請待處理', '看申請'],
      ['trial_followup', '試聽跟進', '看試聽'],
    ])('申請提醒（%s，#1821）：標籤「%s」、連結字「%s」', async (kind, label, go) => {
      received = [notification({ kind, link: '/admin/applications?kind=trial' })];
      await setup();
      const row = qa('notification')[0];
      expect(row.querySelector('[data-testid=kind]')!.textContent).toContain(label);
      expect(row.querySelector('[data-testid=go]')!.textContent).toContain(go);
    });

    it('連結按著 Cmd／Ctrl／Shift 或中鍵點：交給瀏覽器開新分頁，不攔', async () => {
      received = [notification({ link: '/admin/applications' })];
      await setup();
      const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const go = qa('notification')[0].querySelector<HTMLAnchorElement>('[data-testid=go]')!;
      for (const init of [
        { metaKey: true },
        { ctrlKey: true },
        { shiftKey: true },
        { button: 1 },
      ]) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        go.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(nav).not.toHaveBeenCalled();
    });

    // 清單最多 100 則：未讀數是伺服器的，畫面上的列不一定是全部
    it('全部標為已讀：清單外的未讀也一起清掉（角標用伺服器的數，不是畫面上的列數）', async () => {
      received = [notification(), notification({ id: 'n2' })];
      receivedUnread = 130;
      markAllReadMock.mockReturnValue(of({ marked: 130 }));
      await setup();
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(130);
      q('mark-all')!.click();
      fixture.detectChanges();
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(0);
      expect(q('tab-unread')).toBeNull();
    });

    it('全部標為已讀失敗：清單外的未讀也翻回', async () => {
      received = [notification(), notification({ id: 'n2' })];
      receivedUnread = 130;
      markAllReadMock.mockReturnValue(throwError(() => new Error('x')));
      await setup();
      q('mark-all')!.click();
      fixture.detectChanges();
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(130);
      expect(q('tab-unread')!.textContent!.trim()).toBe('未讀 130');
    });

    it('全部標為已讀：全部變已讀、角標 0、toast 寫標了幾則；沒有未讀時 aria-disabled 且不打', async () => {
      received = [notification(), notification({ id: 'n2' })];
      await setup();
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      expect(q('mark-all')!.getAttribute('aria-disabled')).toBe('false');
      q('mark-all')!.click();
      fixture.detectChanges();
      expect(markAllReadMock).toHaveBeenCalledTimes(1);
      expect(qa('notification').every((r) => r.getAttribute('data-read') === 'true')).toBe(true);
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(0);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ summary: '已把 2 則標為已讀' }));

      expect(q('mark-all')!.getAttribute('aria-disabled')).toBe('true');
      q('mark-all')!.click();
      expect(markAllReadMock).toHaveBeenCalledTimes(1);
    });

    it('全部標為已讀失敗：全部翻回、沒有成功 toast、寫一行錯誤', async () => {
      received = [notification(), notification({ id: 'n2' })];
      markAllReadMock.mockReturnValue(throwError(() => new Error('x')));
      await setup();
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      q('mark-all')!.click();
      fixture.detectChanges();
      expect(qa('notification').every((r) => r.getAttribute('data-read') === 'false')).toBe(true);
      expect(setNotificationsUnread).toHaveBeenLastCalledWith(2);
      expect(toast).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('沒有標成已讀，請再按一次。');
    });

    it('讀取失敗：寫查詢失敗，不寫回角標', async () => {
      notifInboxMock.mockImplementation(() => throwError(() => new Error('x')));
      await setup();
      expect(fixture.nativeElement.textContent).toContain('查詢失敗，請稍後再試。');
      expect(setNotificationsUnread).not.toHaveBeenCalled();
      expect(component['headline']()).toBeNull();
    });

    it('沒有 send_announcements：分頁列照樣在，發布分頁是唯讀清單', async () => {
      canSend = false;
      await setup([announcement()]);
      q('tab-publish')!.click();
      fixture.detectChanges();
      expect(qa('announcement')).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('app-page-actions')).toBeNull();
    });
  });
});
