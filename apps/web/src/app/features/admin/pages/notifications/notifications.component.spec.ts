import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AnnouncementsService, type Announcement } from '@core/announcements.service';
import { CampusesService } from '@core/campuses.service';
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

describe('NotificationsComponent（管理端發布）', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let component: NotificationsComponent;

  const listMock = vi.fn();
  const createMock = vi.fn();
  const campusesMock = vi.fn();

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
        {
          provide: AnnouncementsService,
          useValue: { list: listMock, create: createMock },
        },
        { provide: CampusesService, useValue: { list: campusesMock } },
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
        { provide: AnnouncementsService, useValue: { list: listMock, create: createMock } },
        { provide: CampusesService, useValue: { list: campusesMock } },
      ],
    }).compileComponents();

    const f = TestBed.createComponent(NotificationsComponent);
    f.componentRef.setInput('page', RoutesCatalog.ADMIN_NOTIFICATIONS);
    f.detectChanges();

    expect(f.nativeElement.querySelector('.skeleton-list')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.skeleton-bar').length).toBeGreaterThan(0);
  });

  it('標題或內容空白時不能送出', async () => {
    await setup();

    expect(component['canSubmit']()).toBe(false);

    component['title'].set('停課通知');
    expect(component['canSubmit']()).toBe(false);

    component['body'].set('內容');
    expect(component['canSubmit']()).toBe(true);
  });

  it('只有空白字元也算空白', async () => {
    await setup();
    component['title'].set('   ');
    component['body'].set('   ');

    expect(component['canSubmit']()).toBe(false);
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

  // 家長端全是空殼，發給家長沒人收得到
  it('發送對象目前固定是全體老師', async () => {
    await setup();

    expect(component['audience']).toBe('all_teachers');
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
   * 發布時間用 `yyyy-MM-dd`，不是 `yyyy/MM/dd`（#425 M4）。**年份留著**是情境選擇 ——
   * 這是「發布過的全部公告」，會跨年；老師端收件匣（`announcement-inbox`）看的是最近
   * 收到的，所以那邊用短版 `MM/dd HH:mm`。**但分隔符沒有情境理由**，全站其餘每一個
   * 完整日期都是連字號。
   */
  it('發布時間用連字號而不是斜線', async () => {
    await setup([announcement({ campusName: '本校' })]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('2026-08-18');
    expect(text).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
  });

  it('沒有分校的公告顯示為全部分校', async () => {
    await setup([announcement({ campusName: null })]);

    expect(fixture.nativeElement.textContent).toContain('全部分校');
  });
});
