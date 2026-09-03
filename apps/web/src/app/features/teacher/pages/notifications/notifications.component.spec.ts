import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
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

describe('NotificationsComponent（老師收件匣）', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let component: NotificationsComponent;

  const inboxMock = vi.fn();
  const markReadMock = vi.fn();

  async function setup(data: Announcement[] = [announcement()]) {
    inboxMock.mockReset();
    markReadMock.mockReset();
    inboxMock.mockReturnValue(
      of({ data, meta: { total: data.length, unread: data.filter((a) => !a.isRead).length } }),
    );
    markReadMock.mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        {
          provide: AnnouncementsService,
          useValue: { inbox: inboxMock, markRead: markReadMock },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('page', RoutesCatalog.TEACHER_NOTIFICATIONS);
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

  it('沒有公告時顯示空狀態', async () => {
    await setup([]);

    expect(fixture.nativeElement.textContent).toContain('目前沒有公告');
  });

  it('查詢失敗顯示錯誤', async () => {
    inboxMock.mockReset();
    inboxMock.mockReturnValue(throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        { provide: AnnouncementsService, useValue: { inbox: inboxMock, markRead: markReadMock } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(NotificationsComponent);
    f.componentRef.setInput('page', RoutesCatalog.TEACHER_NOTIFICATIONS);
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

    it('只對未讀的送出，已讀的不重複打', async () => {
      await setup([
        announcement({ id: 'a1', isRead: false }),
        announcement({ id: 'a2', isRead: true }),
        announcement({ id: 'a3', isRead: false }),
      ]);
      (component as never as { markAllRead(): void }).markAllRead();

      expect(markReadMock).toHaveBeenCalledTimes(2);
      expect(markReadMock).toHaveBeenCalledWith('a1');
      expect(markReadMock).toHaveBeenCalledWith('a3');
      expect(markReadMock).not.toHaveBeenCalledWith('a2');
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
     * 逐一呼叫是非原子的：一部分成功、一部分失敗會留下混合狀態。
     * **失敗的那幾則要翻回未讀** —— 顯示成已讀但沒存到，下次進來又冒出來更糟
     * （跟既有的單則樂觀更新同一個理由）。
     */
    it('部分失敗時，只有失敗的那則翻回未讀', async () => {
      await setup([
        announcement({ id: 'ok', isRead: false }),
        announcement({ id: 'bad', isRead: false }),
      ]);
      markReadMock.mockImplementation((id: string) =>
        id === 'bad' ? throwError(() => new Error('boom')) : of(undefined),
      );
      (component as never as { markAllRead(): void }).markAllRead();

      const list = (component as never as { announcements(): Announcement[] }).announcements();
      expect(list.find((a) => a.id === 'ok')?.isRead).toBe(true);
      expect(list.find((a) => a.id === 'bad')?.isRead).toBe(false);
    });
  });
});
