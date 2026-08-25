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
});
