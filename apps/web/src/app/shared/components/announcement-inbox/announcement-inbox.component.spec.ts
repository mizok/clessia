import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';

import { AnnouncementInboxComponent } from './announcement-inbox.component';

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

describe('AnnouncementInboxComponent（老師收件匣）', () => {
  let fixture: ComponentFixture<AnnouncementInboxComponent>;
  let component: AnnouncementInboxComponent;

  const inboxMock = vi.fn();
  const markReadMock = vi.fn();
  const markAllReadMock = vi.fn();

  async function setup(data: Announcement[] = [announcement()]) {
    inboxMock.mockReset();
    markReadMock.mockReset();
    markAllReadMock.mockReset();
    inboxMock.mockReturnValue(
      of({ data, meta: { total: data.length, unread: data.filter((a) => !a.isRead).length } }),
    );
    markReadMock.mockReturnValue(of(undefined));
    markAllReadMock.mockReturnValue(of({ marked: 0 }));

    await TestBed.configureTestingModule({
      imports: [AnnouncementInboxComponent],
      providers: [
        {
          provide: AnnouncementsService,
          useValue: { inbox: inboxMock, markRead: markReadMock, markAllRead: markAllReadMock },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnnouncementInboxComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('heading', '通知中心');
    fixture.detectChanges();
  }

  it('顯示未讀數', async () => {
    await setup([
      announcement({ id: 'a', isRead: false }),
      announcement({ id: 'b', isRead: true }),
    ]);

    expect(component['unread']()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('1 則未讀');
  });

  it('全部已讀時不顯示未讀標記', async () => {
    await setup([announcement({ isRead: true })]);

    expect(fixture.nativeElement.textContent).not.toContain('則未讀');
  });

  it('展開會標為已讀', async () => {
    await setup();

    component['toggle'](component['announcements']()[0]);

    expect(markReadMock).toHaveBeenCalledWith('a1');
    expect(component['unread']()).toBe(0);
  });

  // 已讀的不必再打一次 API
  it('展開已讀的公告不重複標記', async () => {
    await setup([announcement({ isRead: true })]);

    component['toggle'](component['announcements']()[0]);

    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('再點一次會收合', async () => {
    await setup();
    const item = component['announcements']()[0];

    component['toggle'](item);
    expect(component['openId']()).toBe('a1');

    component['toggle'](item);
    expect(component['openId']()).toBeNull();
  });

  // 顯示成已讀但實際沒存到，下次進來又冒出來，比當下顯示未讀更糟
  it('標記失敗時翻回未讀', async () => {
    await setup();
    markReadMock.mockReturnValue(throwError(() => new Error('boom')));

    component['toggle'](component['announcements']()[0]);

    expect(component['unread']()).toBe(1);
  });

  // #508：載入中原本是整塊被一行文字取代（沒有骨架尺寸，資料到了會跳版）。
  // 改成骨架列表後這裡改斷言骨架元素，不是文字。
  it('載入中顯示骨架列表，不是整塊被文字取代', async () => {
    inboxMock.mockReturnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [AnnouncementInboxComponent],
      providers: [
        {
          provide: AnnouncementsService,
          useValue: { inbox: inboxMock, markRead: markReadMock, markAllRead: markAllReadMock },
        },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(AnnouncementInboxComponent);
    f.componentRef.setInput('heading', '通知中心');
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

  it('沒有公告時顯示空狀態', async () => {
    await setup([]);

    expect(fixture.nativeElement.textContent).toContain('目前沒有公告');
  });

  it('查詢失敗顯示錯誤', async () => {
    inboxMock.mockReset();
    inboxMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [AnnouncementInboxComponent],
      providers: [
        {
          provide: AnnouncementsService,
          useValue: { inbox: inboxMock, markRead: markReadMock, markAllRead: markAllReadMock },
        },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(AnnouncementInboxComponent);
    f.componentRef.setInput('heading', '通知中心');
    f.detectChanges();

    expect(f.componentInstance['loadError']()).toBe(true);
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
      (component as never as { markAllRead(): void }).markAllRead();

      expect(markAllReadMock).toHaveBeenCalledTimes(1);
      expect(markReadMock).not.toHaveBeenCalled();
    });

    it('沒有未讀就不打 —— 不送一個什麼都不會標的請求', async () => {
      await setup([announcement({ id: 'a1', isRead: true })]);
      (component as never as { markAllRead(): void }).markAllRead();

      expect(markAllReadMock).not.toHaveBeenCalled();
    });

    it('成功後未讀數歸零', async () => {
      await setup([
        announcement({ id: 'a1', isRead: false }),
        announcement({ id: 'a2', isRead: false }),
      ]);
      (component as never as { markAllRead(): void; unread(): number }).markAllRead();
      expect((component as never as { unread(): number }).unread()).toBe(0);
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
      (component as never as { markAllRead(): void }).markAllRead();

      const list = (component as never as { announcements(): Announcement[] }).announcements();
      expect(list.find((a) => a.id === 'a1')?.isRead).toBe(false);
      expect(list.find((a) => a.id === 'a2')?.isRead).toBe(false);
      expect(list.find((a) => a.id === 'old')?.isRead).toBe(true);
    });
  });
});
