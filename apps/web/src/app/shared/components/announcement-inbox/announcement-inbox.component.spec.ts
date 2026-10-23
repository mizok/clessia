import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { vi } from 'vitest';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
import { InboxBadgeService } from '@core/inbox-badge.service';
import { NotificationsService, type AppNotification } from '@core/notifications.service';

import { AnnouncementInboxComponent, type InboxItem } from './announcement-inbox.component';

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
    kind: 'invoice_due',
    title: '十月學費即將到期',
    body: '請於 10/20 前繳費。',
    createdAt: '2026-08-19T02:00:00Z',
    isRead: false,
    link: null,
    hasChangeDetail: false,
    ...overrides,
  };
}

function inboxOf<T extends { isRead: boolean }>(data: T[]) {
  return of({ data, meta: { total: data.length, unread: data.filter((a) => !a.isRead).length } });
}

describe('AnnouncementInboxComponent（老師收件匣）', () => {
  let fixture: ComponentFixture<AnnouncementInboxComponent>;
  let component: AnnouncementInboxComponent;

  const inboxMock = vi.fn();
  const markReadMock = vi.fn();
  const markAllReadMock = vi.fn();
  const notifInboxMock = vi.fn();
  const notifMarkReadMock = vi.fn();
  const notifMarkAllReadMock = vi.fn();
  const changeDetailMock = vi.fn();
  const badge = { setAnnouncementsUnread: vi.fn(), setNotificationsUnread: vi.fn() };
  const messages = { add: vi.fn() };

  /** 只設好 mock 的回傳，不建元件 —— 要改回傳的測試在 create() 前改 */
  function mocks(data: Announcement[] = [announcement()], notifs: AppNotification[] = []): void {
    for (const m of [
      inboxMock,
      markReadMock,
      markAllReadMock,
      notifInboxMock,
      notifMarkReadMock,
      notifMarkAllReadMock,
      changeDetailMock,
      badge.setAnnouncementsUnread,
      badge.setNotificationsUnread,
      messages.add,
    ])
      m.mockReset();
    inboxMock.mockReturnValue(inboxOf(data));
    markReadMock.mockReturnValue(of(undefined));
    markAllReadMock.mockReturnValue(of({ marked: 0 }));
    notifInboxMock.mockReturnValue(inboxOf(notifs));
    notifMarkReadMock.mockReturnValue(of(undefined));
    notifMarkAllReadMock.mockReturnValue(of({ marked: 0 }));
  }

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AnnouncementInboxComponent],
      providers: [
        provideRouter([]),
        {
          provide: AnnouncementsService,
          useValue: { inbox: inboxMock, markRead: markReadMock, markAllRead: markAllReadMock },
        },
        {
          provide: NotificationsService,
          useValue: {
            inbox: notifInboxMock,
            markRead: notifMarkReadMock,
            markAllRead: notifMarkAllReadMock,
            changeDetail: changeDetailMock,
          },
        },
        { provide: InboxBadgeService, useValue: badge },
        { provide: MessageService, useValue: messages },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnnouncementInboxComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('heading', '通知中心');
    fixture.detectChanges();
  }

  async function setup(data: Announcement[] = [announcement()], notifs: AppNotification[] = []) {
    mocks(data, notifs);
    await create();
  }

  const items = () => component['items']() as InboxItem[];
  const unread = () => component['unread']() as number;
  const toggle = (item: InboxItem) => component['toggle'](item);
  const markAllRead = () => component['markAllRead']();

  it('顯示未讀數', async () => {
    await setup([
      announcement({ id: 'a', isRead: false }),
      announcement({ id: 'b', isRead: true }),
    ]);

    expect(unread()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('1 則未讀');
  });

  it('全部已讀時不顯示未讀標記', async () => {
    await setup([announcement({ isRead: true })]);

    expect(fixture.nativeElement.textContent).not.toContain('則未讀');
  });

  it('展開會標為已讀', async () => {
    await setup();

    toggle(items()[0]!);

    expect(markReadMock).toHaveBeenCalledWith('a1');
    expect(unread()).toBe(0);
  });

  // 已讀的不必再打一次 API
  it('展開已讀的公告不重複標記', async () => {
    await setup([announcement({ isRead: true })]);

    toggle(items()[0]!);

    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('再點一次會收合', async () => {
    await setup();
    const item = items()[0]!;

    component['toggle'](item);
    expect(component['openKey']()).toBe('announcement:a1');

    component['toggle'](item);
    expect(component['openKey']()).toBeNull();
  });

  // 顯示成已讀但實際沒存到，下次進來又冒出來，比當下顯示未讀更糟
  it('標記失敗時翻回未讀', async () => {
    await setup();
    markReadMock.mockReturnValue(throwError(() => new Error('boom')));

    toggle(items()[0]!);

    expect(unread()).toBe(1);
  });

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('載入中顯示骨架列表，不是整塊被文字取代', async () => {
    mocks();
    inboxMock.mockReturnValue(NEVER);
    await create();

    expect(fixture.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('.skeleton-list .skeleton').length,
    ).toBeGreaterThan(0);
  });

  it('兩邊都沒有時：色面句寫「還沒有收到通知。」，本體不重複、不畫保留期限', async () => {
    await setup([]);

    const text = fixture.nativeElement.textContent as string;
    expect(text.match(/還沒有收到通知|目前沒有通知/g)).toEqual(['還沒有收到通知']);
    expect(text).not.toContain('通知保留 90 天');
  });

  it('兩邊都查詢失敗才整頁錯誤', async () => {
    mocks();
    inboxMock.mockReturnValue(throwError(() => new Error('boom')));
    notifInboxMock.mockReturnValue(throwError(() => new Error('boom')));
    await create();

    expect(component['loadError']()).toBe(true);
  });

  /**
   * spec 要求「全部標為已讀」按鈕，實作零。三則未讀時老師要點三次才清乾淨。
   *
   * ⚠️ 後端**沒有批次端點** —— 只有 `POST /{id}/read`。所以這裡是對未讀逐一呼叫。
   * 語意跟批次端點一模一樣（同樣的紀錄、同樣的結果），差別只有 N 次往返與非原子。
   */
  describe('全部標為已讀', () => {
    it('有未讀才出現按鈕', async () => {
      await setup([announcement({ id: 'a1', isRead: false })]);
      expect(fixture.nativeElement.textContent).toContain('全部標為已讀');
    });

    it('全部已讀就不顯示 —— 沒有可做的事就不要放按鈕', async () => {
      await setup([announcement({ id: 'a1', isRead: true })]);
      expect(fixture.nativeElement.textContent).not.toContain('全部標為已讀');
    });

    /**
     * 逐一版的「只對未讀的送出」在這裡沒有對應物 —— 批次端點不收 id，
     * 可見範圍由後端算。這裡改測**它只打一次**，那才是換掉逐一版買到的東西。
     */
    it('不管幾則未讀都只打一次，而且不再逐一呼叫 markRead', async () => {
      await setup([
        announcement({ id: 'a1', isRead: false }),
        announcement({ id: 'a2', isRead: true }),
        announcement({ id: 'a3', isRead: false }),
      ]);
      markAllRead();

      expect(markAllReadMock).toHaveBeenCalledTimes(1);
      expect(markReadMock).not.toHaveBeenCalled();
    });

    it('沒有未讀就不打 —— 不送一個什麼都不會標的請求', async () => {
      await setup([announcement({ id: 'a1', isRead: true })]);
      markAllRead();

      expect(markAllReadMock).not.toHaveBeenCalled();
    });

    it('成功後未讀數歸零', async () => {
      await setup([
        announcement({ id: 'a1', isRead: false }),
        announcement({ id: 'a2', isRead: false }),
      ]);
      markAllRead();
      expect(unread()).toBe(0);
    });

    /**
     * **原子端點沒有「部分失敗」** —— 逐一版時這裡測的是「只有失敗的那則翻回未讀」，
     * 那測的是逐一呼叫的限制，不是需求。換成 `read-all` 之後那個狀態不可能出現，
     * 所以這條改測「失敗就整批翻回」。
     *
     * 翻回的是**送出前記下的那批 id**，不是重掃未讀 —— 樂觀更新之後畫面上已經沒有未讀了。
     */
    it('失敗時整批翻回未讀，已讀的不受影響', async () => {
      await setup([
        announcement({ id: 'a1', isRead: false }),
        announcement({ id: 'a2', isRead: false }),
        announcement({ id: 'old', isRead: true }),
      ]);
      markAllReadMock.mockReturnValue(throwError(() => new Error('boom')));
      markAllRead();

      const list = items();
      expect(list.find((a) => a.id === 'a1')?.isRead).toBe(false);
      expect(list.find((a) => a.id === 'a2')?.isRead).toBe(false);
      expect(list.find((a) => a.id === 'old')?.isRead).toBe(true);
    });
  });

  // #1641 項 6：未讀數換了就從下方淡入（A6 dd__v.is-new）；掛在只包數字的元素上
  it('讀了一則：未讀數那個數字重播淡入', async () => {
    await setup([announcement({ id: 'a' }), announcement({ id: 'b' })]);
    const num = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.announcement-inbox__count span',
    )!;
    expect(num.textContent).toBe('2');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const animate = vi.fn();
    num.animate = animate;

    toggle(items()[0]!);
    fixture.detectChanges();

    expect(num.textContent).toBe('1');
    expect(animate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  describe('公告＋通知合併（#1683 第二段）', () => {
    it('依時間合併，新的在前；列上標「公告」「繳費提醒」', async () => {
      await setup(
        [announcement({ id: 'a', publishedAt: '2026-08-18T02:00:00Z' })],
        [notification({ id: 'n', createdAt: '2026-08-19T02:00:00Z' })],
      );
      expect(items().map((i) => `${i.source}:${i.id}`)).toEqual([
        'notification:n',
        'announcement:a',
      ]);
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('繳費提醒 ·');
      expect(text).toContain('公告 ·');
      expect(unread()).toBe(2);
    });

    it('公告和通知同一個 id 也不會撞（展開的是點的那一列）', async () => {
      await setup([announcement({ id: 'x' })], [notification({ id: 'x' })]);
      const n = items().find((i) => i.source === 'notification')!;
      toggle(n);
      expect(component['openKey']()).toBe('notification:x');
      expect(notifMarkReadMock).toHaveBeenCalledWith('x');
      expect(markReadMock).not.toHaveBeenCalled();
    });

    describe('#1100 #49 課務異動：展開「原本／改為」＋看課表，不直接導頁', () => {
      const chg = () =>
        notification({
          id: 'c',
          kind: 'schedule_change',
          link: '/parent/schedule',
          hasChangeDetail: true,
        });
      const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

      it('點了展開（不導頁）、讀原本／改為；調課兩邊都寫，停課改為寫原因、原本劃掉', async () => {
        await setup([], [chg()]);
        changeDetailMock.mockReturnValue(
          of({
            data: [
              {
                sessionId: 's1',
                className: '國一數學 A 班',
                changeType: 'reschedule',
                was: {
                  date: '2026-10-08',
                  startTime: '15:30',
                  endTime: '17:00',
                  teacherName: '王老師',
                },
                now: {
                  date: '2026-10-09',
                  startTime: '15:30',
                  endTime: '17:00',
                  teacherName: '王老師',
                },
                reason: null,
              },
              {
                sessionId: 's2',
                className: '國一數學 A 班',
                changeType: 'cancellation',
                was: {
                  date: '2026-10-11',
                  startTime: '15:30',
                  endTime: '17:00',
                  teacherName: '王老師',
                },
                now: null,
                reason: '颱風',
              },
            ],
          }),
        );
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

        toggle(items()[0]!);
        fixture.detectChanges();

        expect(navigate).not.toHaveBeenCalled();
        expect(changeDetailMock).toHaveBeenCalledWith('c');
        expect(notifMarkReadMock).toHaveBeenCalledWith('c');
        const blocks = (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-part="change-detail"]',
        );
        expect(blocks).toHaveLength(2);
        expect(blocks[0]!.textContent!.replace(/\s+/g, ' ')).toContain(
          '原本 10/8（四）15:30 · 王老師 改為 10/9（五）15:30 · 王老師',
        );
        expect(blocks[1]!.textContent!.replace(/\s+/g, ' ')).toContain('改為 停課（颱風）');
        expect(blocks[1]!.querySelector('dd')!.classList).toContain('line-through');
        const link = (fixture.nativeElement as HTMLElement).querySelector(
          'a[href="/parent/schedule"]',
        );
        expect(link?.textContent).toContain('看課表');
      });

      it('讀過就不重讀；讀失敗寫「讀不到」，再展開會重試', async () => {
        await setup([], [chg()]);
        changeDetailMock
          .mockReturnValueOnce(throwError(() => new Error('boom')))
          .mockReturnValueOnce(of({ data: [] }));
        toggle(items()[0]!);
        fixture.detectChanges();
        expect(text()).toContain('異動內容讀不到');
        toggle(items()[0]!); // 收起
        toggle(items()[0]!); // 再展開 → 重試
        toggle(items()[0]!); // 收起
        toggle(items()[0]!); // 再展開 → 讀過了，不重讀
        expect(changeDetailMock).toHaveBeenCalledTimes(2);
      });
    });

    it('通知有 link：點了先標已讀再導過去', async () => {
      await setup([], [notification({ id: 'n', link: '/parent/payments' })]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      toggle(items()[0]!);
      expect(notifMarkReadMock).toHaveBeenCalledWith('n');
      expect(navigate).toHaveBeenCalledWith('/parent/payments');
      expect(unread()).toBe(0);
    });

    it('點有 link 的通知、導頁之後標已讀的請求不被取消；失敗時角標一起翻回', async () => {
      await setup([], [notification({ id: 'n', link: '/parent/payments' })]);
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      let fail!: (e: unknown) => void;
      notifMarkReadMock.mockReturnValue(
        new Observable<void>((sub) => {
          fail = (e) => sub.error(e);
        }),
      );
      toggle(items()[0]!);
      expect(badge.setNotificationsUnread).toHaveBeenLastCalledWith(0);

      fixture.destroy(); // 導頁 → 元件 destroy
      fail(new Error('boom'));
      expect(badge.setNotificationsUnread).toHaveBeenLastCalledWith(1);
    });

    it('通知讀取失敗：公告照樣顯示，寫一行「通知暫時讀不到」', async () => {
      mocks([announcement()]);
      notifInboxMock.mockReturnValue(throwError(() => new Error('boom')));
      await create();
      expect(component['loadError']()).toBe(false);
      expect(items()).toHaveLength(1);
      expect(fixture.nativeElement.textContent).toContain('通知暫時讀不到');
    });

    it('全部標為已讀：兩支平行打；一邊失敗只翻那一邊，並提示再按一次', async () => {
      mocks([announcement({ id: 'a' })], [notification({ id: 'n' })]);
      notifMarkAllReadMock.mockReturnValue(throwError(() => new Error('boom')));
      await create();
      markAllRead();
      fixture.detectChanges();

      expect(markAllReadMock).toHaveBeenCalledTimes(1);
      expect(notifMarkAllReadMock).toHaveBeenCalledTimes(1);
      expect(items().find((i) => i.id === 'a')?.isRead).toBe(true);
      expect(items().find((i) => i.id === 'n')?.isRead).toBe(false);
      expect(unread()).toBe(1);
      expect(fixture.nativeElement.textContent).toContain('有一部分沒標成');
    });

    it('未讀數用伺服器的 meta.unread（通知清單最多 100 則，不數畫面上的）', async () => {
      mocks([]);
      notifInboxMock.mockReturnValue(
        of({ data: [notification()], meta: { total: 150, unread: 120 } }),
      );
      await create();
      expect(unread()).toBe(120);
      markAllRead();
      expect(unread()).toBe(0);
      expect(notifMarkAllReadMock).toHaveBeenCalledTimes(1);
    });

    it('寫回頂欄角標：讀到、讀了一則之後；讀取失敗那邊不寫（角標保留它自己的值）', async () => {
      mocks([announcement({ id: 'a' }), announcement({ id: 'b' })]);
      notifInboxMock.mockReturnValue(throwError(() => new Error('boom')));
      await create();
      expect(badge.setAnnouncementsUnread).toHaveBeenLastCalledWith(2);
      expect(badge.setNotificationsUnread).not.toHaveBeenCalled();

      toggle(items()[0]!);
      fixture.detectChanges();
      expect(badge.setAnnouncementsUnread).toHaveBeenLastCalledWith(1);
    });
  });

  /** 收件匣自己還沒讀到、或讀不到時，角標保留 InboxBadgeService 自己抓到的值（審核席 #1691 突變） */
  describe('不寫回角標的時候', () => {
    it('公告讀取失敗：不寫公告那一支（角標原本是 3 就還是 3）', async () => {
      mocks([], [notification()]);
      inboxMock.mockReturnValue(throwError(() => new Error('boom')));
      await create();
      expect(badge.setAnnouncementsUnread).not.toHaveBeenCalled();
      expect(badge.setNotificationsUnread).toHaveBeenLastCalledWith(1);
    });

    it('載入完成前：兩支都不寫（不會先寫一個 0）', async () => {
      mocks();
      inboxMock.mockReturnValue(NEVER);
      notifInboxMock.mockReturnValue(NEVER);
      await create();
      expect(badge.setAnnouncementsUnread).not.toHaveBeenCalled();
      expect(badge.setNotificationsUnread).not.toHaveBeenCalled();
    });
  });

  /** 審核席 #1710 突變 */
  describe('全部標為已讀的邊界', () => {
    it('畫面上的都已讀、但伺服器說還有未讀（清單上限 100 之外）：照樣送出', async () => {
      mocks([]);
      notifInboxMock.mockReturnValue(
        of({ data: [notification({ isRead: true })], meta: { total: 150, unread: 30 } }),
      );
      await create();
      markAllRead();
      expect(notifMarkAllReadMock).toHaveBeenCalledTimes(1);
      expect(unread()).toBe(0);
    });

    it('一邊失敗出現提示 → 再按一次兩邊都成功 → 提示消失', async () => {
      mocks([announcement({ id: 'a' })], [notification({ id: 'n' })]);
      notifMarkAllReadMock.mockReturnValue(throwError(() => new Error('boom')));
      await create();
      markAllRead();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('有一部分沒標成');

      notifMarkAllReadMock.mockReturnValue(of({ marked: 1 }));
      markAllRead();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('有一部分沒標成');
      expect(unread()).toBe(0);
    });
  });

  describe('A6 排版（#1888）', () => {
    // 台北 2026-08-20 10:00
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    const text = () => (fixture.nativeElement as HTMLElement).textContent!;
    const h1 = () => (fixture.nativeElement as HTMLElement).querySelector('app-page-open h1')!;

    it('依今天／昨天／這週／更早分章（台北日期），空的章不畫，章頭寫則數與未讀', async () => {
      await setup(
        [
          announcement({ id: 'today', publishedAt: '2026-08-19T17:00:00Z' }), // 台北 8/20 01:00
          announcement({ id: 'yday', publishedAt: '2026-08-19T15:00:00Z', isRead: true }), // 8/19 23:00
          announcement({ id: 'old', publishedAt: '2026-08-01T02:00:00Z', isRead: true }),
        ],
        [notification({ id: 'week', createdAt: '2026-08-15T02:00:00Z' })],
      );
      const chapters = component['chapters']() as {
        name: string;
        items: InboxItem[];
        unread: number;
      }[];
      expect(chapters.map((c) => [c.name, c.items.map((i) => i.id), c.unread])).toEqual([
        ['今天', ['today'], 1],
        ['昨天', ['yday'], 0],
        ['這週', ['week'], 1],
        ['更早', ['old'], 0],
      ]);
      const sections = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.announcement-inbox__chapter',
      );
      expect(Array.from(sections).map((x) => x.getAttribute('aria-label'))).toEqual([
        '今天',
        '昨天',
        '這週',
        '更早',
      ]);
    });

    // 「這週」＝今天往前 6 天內（A6 `d > addDays(T, -7)`）：第 6 天還在這週、第 7 天就是更早
    it('「這週」邊界：往前第 6 天算這週、第 7 天算更早', async () => {
      await setup([
        announcement({ id: 'd6', publishedAt: '2026-08-14T02:00:00Z' }), // 台北 8/14
        announcement({ id: 'd7', publishedAt: '2026-08-13T02:00:00Z' }), // 台北 8/13
      ]);
      const chapters = component['chapters']() as { name: string; items: InboxItem[] }[];
      expect(chapters.map((c) => [c.name, c.items.map((i) => i.id)])).toEqual([
        ['這週', ['d6']],
        ['更早', ['d7']],
      ]);
    });

    it('沒有東西的章不畫（只有今天與更早，就沒有昨天、這週）', async () => {
      await setup([
        announcement({ id: 'today', publishedAt: '2026-08-20T01:00:00Z' }),
        announcement({ id: 'old', publishedAt: '2026-08-01T01:00:00Z' }),
      ]);
      const names = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.announcement-inbox__chapter'),
      ).map((x) => x.getAttribute('aria-label'));
      expect(names).toEqual(['今天', '更早']);
    });

    it('色面句：「N 則未讀，／今天 M 則新通知。」', async () => {
      await setup([
        announcement({ id: 'a', publishedAt: '2026-08-20T01:00:00Z' }),
        announcement({ id: 'b', publishedAt: '2026-08-01T01:00:00Z' }),
      ]);
      expect(h1().textContent).toContain('2 則未讀，');
      expect(h1().textContent).toContain('今天 1 則新通知。');
    });

    it('色面句：全部讀過「通知都看過了。」、空的「還沒有收到通知。」、載入中退回頁名', async () => {
      await setup([announcement({ isRead: true })]);
      expect(h1().textContent?.trim()).toBe('通知都看過了。');
      TestBed.resetTestingModule();
      await setup([]);
      expect(h1().textContent?.trim()).toBe('還沒有收到通知。');
      TestBed.resetTestingModule();
      mocks();
      inboxMock.mockReturnValue(NEVER);
      await create();
      expect(h1().textContent?.trim()).toBe('通知中心');
    });

    it('工具列寫未讀數；沒有未讀寫「沒有未讀」', async () => {
      await setup([announcement({ isRead: true })]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.announcement-inbox__count')!
          .textContent,
      ).toContain('沒有未讀');
    });

    it('全部標為已讀：兩支都回來後 toast 一則，N 是伺服器實際標的合計', async () => {
      mocks([announcement({ id: 'a' })], [notification({ id: 'n' })]);
      markAllReadMock.mockReturnValue(of({ marked: 1 }));
      notifMarkAllReadMock.mockReturnValue(of({ marked: 3 }));
      await create();
      markAllRead();
      expect(messages.add).toHaveBeenCalledTimes(1);
      expect(messages.add).toHaveBeenCalledWith({
        severity: 'success',
        summary: '已把 4 則標為已讀',
      });
    });

    it('全部標為已讀：一邊失敗，照樣 toast 成功那邊標的數；全失敗不 toast', async () => {
      mocks([announcement({ id: 'a' })], [notification({ id: 'n' })]);
      markAllReadMock.mockReturnValue(of({ marked: 1 }));
      notifMarkAllReadMock.mockReturnValue(throwError(() => new Error('boom')));
      await create();
      markAllRead();
      expect(messages.add).toHaveBeenCalledWith({
        severity: 'success',
        summary: '已把 1 則標為已讀',
      });

      messages.add.mockReset();
      markAllReadMock.mockReturnValue(throwError(() => new Error('boom')));
      markAllRead();
      expect(messages.add).not.toHaveBeenCalled();
    });

    it('底部寫保留期限：通知 90 天、公告一直留著（API 只清通知，#1661）', async () => {
      await setup();
      expect(text()).toContain('通知保留 90 天，公告會一直留著。');
    });
  });

  it.each([
    ['schedule_change', '課務異動'],
    ['leave_for_my_class', '請假'],
    ['leave_received', '請假'],
    ['leave_streak', '連續請假'],
    ['invoice_overdue', '繳費提醒'],
    ['something_new', '通知'],
  ])('通知 kind %s 的標籤是「%s」', async (kind, label) => {
    await setup([], [notification({ kind })]);
    expect(items()[0]!.label).toBe(label);
    expect(fixture.nativeElement.textContent).toContain(`${label} ·`);
  });
});
